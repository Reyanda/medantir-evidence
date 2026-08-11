# Supervised login handoff

Open and authenticated evidence sources use different execution paths.

1. Open APIs execute directly in the review engine.
2. Licensed databases resolve to a provider/database recipe and an expected saved session reference.
3. If the saved session is absent, expired, challenged by MFA, or lacks entitlement, the search returns `AUTH REQUIRED` rather than substituting another database.
4. The operator completes login in Medantir Desktop/Browser and saves the authorized session under the requested reference.
5. The exact database search is replayed through the browser bridge and its native export is parsed and reconciled.

Passwords, MFA codes, bearer tokens and cookie values do not enter review artifacts, prompts, audit logs or Git history.
