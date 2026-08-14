# Kubernetes deployment

These manifests deploy the MEDANTIR review service and Evidence OS API as one hardened **single-replica** workload.

## Scientific and coordination boundary

Keep `spec.replicas: 1` and `strategy.type: Recreate` until the service has all of the following:

- a transactional run and ownership store;
- distributed leases and heartbeats;
- a durable work queue;
- immutable large-object storage;
- cross-worker checkpoint ordering;
- dead-letter and external-action reconciliation operations.

The current hash-chained checkpoint journal is crash-safe, but the run ownership index and scheduler are single-process resources. Do not add a HorizontalPodAutoscaler to this deployment.

## Build and publish the image

The deployment references:

```text
ghcr.io/reyanda/medantir-evidence-review:0.6.0
```

Publish that image from `medantir-review/Dockerfile`, or replace it before applying:

```bash
docker build -t YOUR_REGISTRY/medantir-evidence-review:0.6.0 medantir-review
docker push YOUR_REGISTRY/medantir-evidence-review:0.6.0

cd deploy/kubernetes
kustomize edit set image \
  ghcr.io/reyanda/medantir-evidence-review=YOUR_REGISTRY/medantir-evidence-review:0.6.0
```

## Create production secrets

Generate a 32-byte credential master key and create the secret without committing it:

```bash
kubectl apply -f deploy/kubernetes/namespace.yaml

MASTER_KEY="$(openssl rand -base64 32)"
kubectl -n medantir-evidence create secret generic medantir-evidence-secrets \
  --from-literal=CORS_ORIGINS='https://evidence.example.org' \
  --from-literal=COGNITO_USER_POOL_ID='us-east-1_example' \
  --from-literal=COGNITO_CLIENT_ID='example-client-id' \
  --from-literal=REVIEW_CREDENTIAL_MASTER_KEY="$MASTER_KEY"
```

Optional keys in the same secret are:

```text
ORCID_CLIENT_ID
ORCID_CLIENT_SECRET
ORCID_REDIRECT_URI
OMNIROUTE_API_KEY
```

Never rotate `REVIEW_CREDENTIAL_MASTER_KEY` without a credential-envelope migration or a deliberate decision to invalidate all encrypted credentials.

## Apply

```bash
kubectl apply -k deploy/kubernetes
kubectl -n medantir-evidence rollout status deployment/medantir-evidence
kubectl -n medantir-evidence get pods,service,pvc
```

Verify from inside the cluster:

```bash
kubectl -n medantir-evidence run healthcheck \
  --rm -i --restart=Never --image=curlimages/curl \
  -- http://medantir-evidence/health
```

## Ingress and TLS

The included service is `ClusterIP`. Add an environment-specific ingress, gateway, or service mesh that:

- terminates TLS;
- preserves `Authorization` and `X-Actiora-Project` headers;
- applies request-size and rate limits appropriate to uploaded review material;
- restricts Evidence OS and review routes to the intended audience;
- does not cache authenticated run responses.

## Persistence and backup

The `ReadWriteOnce` claim is mounted at `/data`. Back up the whole volume as one consistency unit, including:

```text
/data/control/runs.json
/data/durability
/data/credentials
```

The master key is supplied by the Kubernetes secret and must be backed up separately under the organisation's secret-management and recovery procedures.

A safe restore test must prove:

1. ownership records load;
2. hash-chained checkpoints verify;
3. encrypted credentials decrypt with the restored key;
4. interrupted runs recover without consuming scientific retry budget;
5. external actions reconcile without duplicate remote mutation.

## Network policy

No generic NetworkPolicy is applied because required egress and ingress identities depend on the cluster, DNS implementation, ingress controller, bibliographic APIs, registries, LiteParse, and institutional bridge topology. Apply a deployment-specific default-deny policy and explicitly allow only those routes.

## Scaling roadmap

The interfaces in `medantir-review/src/evidence-os/ports.ts` define replacement seams for:

- Temporal, Dagster, Prefect, or Airflow;
- Kafka, RabbitMQ, or Redis Streams;
- immutable artifact storage;
- a durable evidence-object and graph repository.

Implement and certify those backends before changing the replica count.
