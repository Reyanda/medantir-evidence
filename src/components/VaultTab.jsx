import React, { useEffect, useRef, useState } from "react";
import { Download, FileUp, KeyRound, Lock, ShieldCheck, Unlock } from "lucide-react";
import {
  currentVaultUserId,
  exportEncryptedVault,
  importEncryptedVault,
  lockVault,
  migrateLegacySecrets,
  setVaultRecovery,
  unlockVault,
  unlockVaultWithAccountPassword,
  vaultStatus,
} from "../engine/secureVault.js";
import { forgetInstitutionalCredentials, saveInstitutionalCredentials, storedCredentialProviders } from "../engine/institutionalAccess.js";
import { isSudo, listAccounts, setRole } from "../engine/accounts.js";

export default function VaultTab() {
  const [, force] = useState(0);
  const refresh = () => force((value) => value + 1);
  const [passphrase, setPassphrase] = useState("");
  const [message, setMessage] = useState("");
  const importInput = useRef(null);
  const status = vaultStatus();

  const [recoveryPw, setRecoveryPw] = useState("");
  const [settingRecovery, setSettingRecovery] = useState(false);
  const [credUser, setCredUser] = useState("");
  const [credPass, setCredPass] = useState("");
  const [credProvider, setCredProvider] = useState("default");
  const [savedProviders, setSavedProviders] = useState([]);

  useEffect(() => { storedCredentialProviders().then(setSavedProviders).catch(() => setSavedProviders([])); }, [status.unlocked, message]);

  const saveCredentials = async () => {
    if (!credUser.trim() && !credPass) { setMessage("Enter a username or password first."); return; }
    await saveInstitutionalCredentials({ username: credUser.trim(), password: credPass, providerId: credProvider });
    setCredUser("");
    setCredPass("");
    setMessage(`Institutional credentials stored for ${credProvider}, encrypted in your vault.`);
    refresh();
  };

  const forgetCredentials = async (providerId) => {
    await forgetInstitutionalCredentials(providerId);
    setMessage(`Credentials for ${providerId} removed.`);
    refresh();
  };

  const unlock = async () => {
    const result = await unlockVault(passphrase);
    setMessage(result.ok ? result.created ? "Encrypted vault created and unlocked." : "Vault unlocked for this session." : result.error);
    if (result.ok) setPassphrase("");
    refresh();
  };

  const recoverWithAccount = async () => {
    if (!recoveryPw) return;
    const result = await unlockVaultWithAccountPassword(recoveryPw);
    setMessage(result.ok ? "Vault recovered using your account password." : result.error);
    if (result.ok) { setRecoveryPw(""); refresh(); }
  };

  const enableRecovery = async () => {
    if (!recoveryPw) return;
    const result = await setVaultRecovery(recoveryPw);
    setMessage(result.ok ? result.message : result.error);
    if (result.ok) setRecoveryPw("");
  };

  const migrate = async () => {
    const result = await migrateLegacySecrets();
    setMessage(result.ok ? `${result.migrated.length} legacy credential record${result.migrated.length === 1 ? "" : "s"} encrypted and removed from plaintext stores.` : result.error);
    refresh();
  };

  const exportBackup = () => {
    const encrypted = exportEncryptedVault();
    if (!encrypted) return;
    const url = URL.createObjectURL(new Blob([encrypted], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `medantir-vault-${currentVaultUserId().replace(/[^a-z0-9]+/gi, "-")}.encrypted.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const result = importEncryptedVault(await file.text());
    setMessage(result.ok ? "Encrypted backup imported. Unlock it with its passphrase." : result.error);
    if (importInput.current) importInput.current.value = "";
    refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-emerald-500" /> Security & Vault</h1>
      </div>

      <div className={`rounded-xl border p-4 ${status.unlocked ? "border-emerald-500/40 bg-emerald-500/[0.04]" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f]"}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {status.unlocked ? <Unlock className="h-5 w-5 text-emerald-500" /> : <Lock className="h-5 w-5 text-amber-500" />}
            <div><div className="text-sm font-semibold">{status.unlocked ? "Vault unlocked" : status.exists ? "Vault locked" : "Create your vault"}</div><div className="text-[10px] font-mono text-zinc-400">{status.count} encrypted secret purpose{status.count === 1 ? "" : "s"}</div></div>
          </div>
          {status.unlocked ? <button onClick={() => { lockVault(); setMessage("Vault locked and decrypted material removed from memory."); refresh(); }} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-amber-500/40 text-amber-600"><Lock className="h-3.5 w-3.5" /> Lock</button> : (
            <div className="flex items-center gap-2">
              <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} onKeyDown={(event) => event.key === "Enter" && unlock()} autoComplete="current-password" placeholder={status.exists ? "vault passphrase" : "new vault passphrase (10+ chars)"} aria-label="Vault passphrase" className="text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-emerald-500" />
              <button onClick={unlock} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-2 rounded-lg"><KeyRound className="h-3.5 w-3.5" /> {status.exists ? "Unlock" : "Create"}</button>
            </div>
          )}
        </div>

        {/* Institutional sign-in credentials. One set usually opens several
            providers, so it is stored once and filled per provider on request. */}
        {status.unlocked && (
          <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Institutional sign-in</div>
            <div className="text-[10px] text-zinc-500">
              Saved encrypted here and filled into a provider's login form from the Browser tab's <span className="font-mono">Fill</span> button. Never sent anywhere; you still press the provider's own sign-in button, so MFA is not bypassed.
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={credUser} onChange={(event) => setCredUser(event.target.value)} placeholder="Institutional username" autoComplete="off" aria-label="Institutional username" className="text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-emerald-500 flex-1 min-w-40" />
              <input type="password" value={credPass} onChange={(event) => setCredPass(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveCredentials()} placeholder="Institutional password" autoComplete="new-password" aria-label="Institutional password" className="text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-emerald-500 flex-1 min-w-40" />
              <select value={credProvider} onChange={(event) => setCredProvider(event.target.value)} aria-label="Applies to" className="text-xs px-2 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                <option value="default">All providers</option>
                <option value="ovid">Ovid</option>
                <option value="elsevier">Elsevier (Embase/Scopus)</option>
                <option value="ebscohost">EBSCOhost (CINAHL)</option>
                <option value="clarivate">Web of Science</option>
                <option value="research4life">Research4Life</option>
                <option value="cochrane">Cochrane</option>
              </select>
              <button onClick={saveCredentials} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-2 rounded-lg"><KeyRound className="h-3.5 w-3.5" /> Save</button>
            </div>
            {savedProviders.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[9px] text-zinc-400">Saved for:</span>
                {savedProviders.map((id) => (
                  <button key={id} onClick={() => forgetCredentials(id)} title={`Forget credentials for ${id}`} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:line-through">{id} ×</button>
                ))}
              </div>
            )}
          </div>
        )}

        {status.unlocked && status.purposes.length > 0 && <div className="flex flex-wrap gap-1 mt-3">{status.purposes.map((purpose) => <span key={purpose} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">{purpose}</span>)}</div>}

        {/* Recovery: logged-in users can recover vault with account password */}
        {!status.unlocked && status.exists && (
          <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Vault recovery</div>
            <div className="text-[10px] text-zinc-500">Unlock your vault using your account password (recovery key must have been set while the vault was unlocked).</div>
            <div className="flex items-center gap-2">
              <input type="password" value={recoveryPw} onChange={(e) => setRecoveryPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && recoverWithAccount()} placeholder="Account password" className="text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-emerald-500 flex-1" />
              <button onClick={recoverWithAccount} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-2 rounded-lg">Recover</button>
            </div>
          </div>
        )}

        {/* Set recovery key while vault is unlocked */}
        {status.unlocked && (
          <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Set recovery password</div>
            <div className="text-[10px] text-zinc-500">{settingRecovery ? "Enter your account password to store a recovery key with the vault." : "Once set, you can unlock the vault with your account password if you forget the vault passphrase."}</div>
            {settingRecovery ? (
              <div className="flex items-center gap-2">
                <input type="password" value={recoveryPw} onChange={(e) => setRecoveryPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enableRecovery()} placeholder="Account password" className="text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-emerald-500 flex-1" />
                <button onClick={enableRecovery} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-2 rounded-lg">Store recovery key</button>
                <button onClick={() => setSettingRecovery(false)} className="text-xs text-zinc-400">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setSettingRecovery(true)} className="text-[10px] px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">Enable account-password recovery</button>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={migrate} disabled={!status.unlocked} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"><ShieldCheck className="h-3.5 w-3.5" /> Encrypt legacy credentials</button>
          <button onClick={exportBackup} disabled={!status.exists} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"><Download className="h-3.5 w-3.5" /> Export encrypted backup</button>
          <button onClick={() => importInput.current?.click()} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700"><FileUp className="h-3.5 w-3.5" /> Import encrypted backup</button>
          <input ref={importInput} type="file" accept="application/json,.json" onChange={importBackup} className="hidden" />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-brand-primary)]/30 bg-[var(--color-brand-primary)]/[0.03] p-4 space-y-1">
        <div className="text-sm font-semibold">Institutional sign-ins (Ovid, Scopus, Web of Science, CINAHL)</div>
        <div className="text-[11px] text-zinc-500">These happen in the <span className="font-medium text-zinc-700 dark:text-zinc-300">Browser tab</span>: sign in there once with your own credentials and MFA, then save the session under the database name (e.g. <span className="font-mono">db/ovid/qmul</span>) so the review engine can replay it. Medantir never sees or extracts your password.</div>
      </div>

      {isSudo() && <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="text-sm font-semibold">Device account roles</div>
        <div className="text-[11px] text-zinc-500 mt-1 mb-3">Sudo-only local role administration. Production identity should delegate authentication and session management to the server identity provider.</div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{listAccounts().map((account) => <div key={account.email} className="py-2 flex items-center gap-3"><div className="min-w-0"><div className="text-xs font-medium truncate">{account.name}</div><div className="text-[10px] font-mono text-zinc-400 truncate">{account.email}</div></div><select value={account.role} onChange={(event) => { const result = setRole(account.email, event.target.value); setMessage(result.ok ? `Updated ${account.email}.` : result.error); refresh(); }} className="ml-auto text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"><option value="user">user</option><option value="sudo">sudo</option></select></div>)}</div>
      </div>}

      {message && <div role="status" className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">{message}</div>}
    </div>
  );
}
