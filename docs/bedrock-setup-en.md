# Bedrock API Key Setup Guide

The Agent LLMs's Bedrock backend authenticates with a single **Bedrock API key (bearer token)**. Enter it once per device, and you are done — no re-login.

## Why API Keys Only

Version 0.3.0 removed `~/.aws` profile authentication (including SSO) and long-term access key authentication.

| Method | Why it was removed |
|---|---|
| AWS access keys | Long-lived credentials with the largest blast radius. When the key field was empty, the SDK's default credential chain would fall back and silently call with an unintended account. |
| `~/.aws` profiles (SSO) | Require `aws sso login` on every device, with tokens expiring every 8–12 hours. Too much friction for a note-taking app used across multiple machines. |
| IAM Roles Anywhere | Require issuing a separate X.509 certificate per device. By design, certificates cannot be shared, because copying them makes device identity meaningless. |

Bedrock API keys are entered once per device. Expiration is managed in the AWS Console.

## Prerequisites

| Item | Requirement |
|---|---|
| AWS account | Model access must be enabled in the region you will use Bedrock in |
| IAM permissions | The four permissions listed below |
| Plugin | Desktop only |

```
bedrock:InvokeModelWithResponseStream
bedrock:InvokeModel
bedrock:ListFoundationModels
bedrock:ListInferenceProfiles
```

`bedrock:ListInferenceProfiles` is required. Chat models are selected from a dropdown only, so without this permission the list will be empty and you will not be able to choose a model.

## 1. Enable Model Access

In the AWS Console, navigate to Bedrock → **Model access** and request access to the models you plan to use. Access must be requested per region.

You need at least one chat model and one embedding model. The embedding model is used for vault indexing (Graph RAG). The plugin supports Amazon Titan and Cohere Embed families.

To verify from the terminal:

```bash
aws bedrock list-foundation-models \
  --region ap-northeast-2 \
  --query 'modelSummaries[?outputModality==`EMBEDDING`].modelId' \
  --output table
```

If the list is empty, no embedding models are enabled in that region yet.

## 2. Issue an API Key

In the AWS Console, navigate to Bedrock → **API keys** and issue a key.

There are two types:

| Type | Validity | Use case |
|---|---|---|
| Short-term | Up to 12 hours | Temporary testing |
| Long-term | Set at issuance (unlimited max) | This plugin |

**Issue a long-term key.** Short-term keys expire after 12 hours and require re-entry.

Keys are shown only once, immediately after issuance. Copy it then.

> An issued key inherits the permissions of the specific IAM user it belongs to. Following the principle of least privilege, it is safer to issue the key from a user with only the four permissions above.

## 3. Configure the Plugin

1. Open Settings → **Agent LLMs**
2. Set **AI Backend** to `Bedrock`
3. Paste the issued key into **Bedrock API Key** (the eye icon reveals the value)
4. Enter the region where you enabled model access in **AWS Region** (e.g., `ap-northeast-2`)
5. Choose from the **Bedrock Chat Model** and **Bedrock Embedding Model** dropdowns

If the model dropdowns are empty, this is a permission or region issue — see Troubleshooting below.

### The Key Is Not Stored in Your Vault

The API key is encrypted with the OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret) and stored in a local-only file under the Electron userData directory. It never lands in your vault's `data.json`, so syncing your vault does not propagate the key.

In environments where the OS keychain is unavailable, the key is **not written to disk at all**. This is intentional to avoid storing it in plaintext. You will need to re-enter the key each time the plugin restarts.

## Using Multiple Devices

**Enter the API key once per device, and you are done.** No re-login or certificate issuance.

| Item | Synced | Action |
|---|---|---|
| API key | ✗ (intentional) | Enter in settings on each device |
| Plugin settings (model, region) | ○ (when vault is synced) | Automatic |
| Vault index | ○ | See below |

You can use the same key on multiple devices, or issue a separate key per device. **Issuing per device lets you revoke only the lost device's key if one is compromised.**

### The Vault Index Is Shared Across Devices

When you sync your vault, `.agent-llms-index.json` moves with it. It contains embedding vectors and can reach tens of MB.

**If the embedding model is the same,** search works immediately on a new device without re-indexing. The plugin decides using an embedding signature of the form `{provider}:{model ID}` (e.g., `bedrock:amazon.titan-embed-text-v2:0`).

**If the embedding model differs per device,** the signature mismatch discards stale vectors, and you are told to re-index. In the meantime, search falls back to keyword matching. Keep the embedding model the same across devices to avoid this.

If your sync tool is configured to exclude dotfiles, the index will not move. In that case, index once on the new device.

## Troubleshooting

### `Bedrock API 키가 설정되지 않았습니다` (Bedrock API key is not configured)

Enter the key in settings. The plugin **intentionally fails** when the key is empty — falling back to the AWS SDK's default credential chain could silently pick up the `[default]` profile in `~/.aws/credentials`, environment variables, or IAM roles, sending your notes and charges to an account you did not choose.

If you entered the key but still see this error, the OS keychain may be unavailable. In that case the key is not persisted to disk, so you must re-enter it each time the plugin restarts.

### Model Dropdowns Are Empty

Check three things:

1. The region is correct — the region in settings must match the region where you enabled model access
2. Model access is enabled — use the `aws bedrock list-foundation-models` command from section 1
3. Permissions — the chat list requires `bedrock:ListInferenceProfiles`, the embedding list requires `bedrock:ListFoundationModels`

Models can only be selected from dropdowns, so without list permissions you cannot configure a model. Add the permissions to your IAM policy.

### `ExpiredTokenException` or `401`

You are likely using a short-term API key (12 hours max). Issue a new long-term key in the console and replace it.

### `AccessDeniedException`

The IAM user linked to the key lacks the permissions above, or lacks access to the model you are invoking. Check the model's status in Model access in the console.

### `ValidationException` (when calling embedding)

You may have selected an unsupported embedding model. The plugin implements request/response schemas only for Amazon Titan and Cohere Embed families. The dropdown exposes only supported models, but if a different model ID is saved in an old config, this error can occur.

### Search Results Are Wrong After Changing the Embedding Model

When embedding dimensions change, existing vectors cannot be compared. The plugin detects this, discards old vectors, and tells you to re-index. Follow the prompt and re-index the vault. Until then, search falls back to keyword matching.

## Network Usage

| Target | Purpose |
|---|---|
| `bedrock-runtime.{region}.amazonaws.com` | Chat and embedding calls |
| `bedrock.{region}.amazonaws.com` | Model list queries |

Credentials are stored locally only. No data is sent to third-party analytics or tracking services.
