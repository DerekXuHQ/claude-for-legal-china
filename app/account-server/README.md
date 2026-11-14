# 账号服务（中国法律检索）

App 的账号和在线模型开通。单个文件 `server.mjs`，Node 22.13+，不依赖第三方包，数据存在 `data/`（SQLite）。

## 用户这边

- 邮箱 + 密码注册，提交即注册成功，状态是「待开通」。不登录也能用检索、浏览、事项、台账和本机小模型。
- 管理员开通后，App 下次打开（或在「设置 → 账号」点刷新）自动拿到接口地址和 API key，直接能用在线模型。
- App 内可以修改密码、退出登录、删除账号（App Store 5.1.1(v)）。删除账号会作废自动生成的 key。

## 管理员后台

打开 `https://<域名>/admin`，密码在 `data/admin-password.txt`（首次启动时生成）。

| 操作 | 说明 |
|---|---|
| 开通 | 二选一：**自动生成 key**（调 LiteLLM `/key/generate`，可设每期额度、限定模型）或**手动填写**接口地址 + key |
| 更换 key | 重新开通；旧的自动生成 key 会作废 |
| 收回 | 回到「待开通」，作废自动生成的 key |
| 停用 / 恢复 | 停用会作废 key 并让所有设备退出登录，可以写一句给用户看的原因 |
| 重置密码 | 生成一个临时密码，你转告用户 |
| 删除 | 删除账号，作废 key |
| 操作记录 | 最近 200 条注册、登录、开通、删除记录 |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/register` | `{email, password, name?, org?, purpose?, platform?}` → `{token, account}` |
| POST | `/v1/login` | `{email, password}` → `{token, account}` |
| GET | `/v1/me` | `{account}`；已开通时 `account.provision = {base_url, api_key, model}` |
| POST | `/v1/me/profile`、`/v1/me/password`、`/v1/me/delete`、`/v1/logout` | |
| GET | `/v1/assets/local-model/manifest`、`/v1/assets/local-model/<文件>` | 本机小模型文件，支持 Range 断点下载，不需要登录 |
| GET | `/admin`、`/privacy`、`/support`、`/healthz` | 网页 |

令牌 180 天有效，服务端只存 sha256；密码用 scrypt；分配的 API key 用 AES-256-GCM 加密存储（密钥 `data/secret.key`）。登录、注册按 IP 限流。

## 配置（环境变量，或写在 `data/.env`）

```
PORT=4870
HOST=127.0.0.1
PUBLIC_URL=https://legal.portkey.bond          # 对外地址
LITELLM_URL=http://127.0.0.1:4000              # 可选：自动生成 key
LITELLM_MASTER_KEY=sk-...                      # 可选
LITELLM_PUBLIC_URL=https://api.portkey.bond/v1 # 自动生成的 key 交给 App 时配的接口地址
LOCAL_MODEL_DIR=./data/local-model             # 本机小模型文件（含 manifest.json）
```

本机小模型用 Qwen3-0.6B 4bit（MLX，约 350 MB；mlx-community/Qwen3-0.6B-4bit）。放进 `LOCAL_MODEL_DIR` 后运行 `node make-manifest.mjs <目录> qwen3-0.6b-4bit <日期>` 生成 `manifest.json`。换模型只要换服务端文件，App 不用改。

## 本机试跑

```bash
cd app/account-server && node server.mjs
```

App 里把 `settings.json` 的 `account_server` 改成 `http://127.0.0.1:4870` 就连本机（只有开发时这样做；正式地址写在 `server/account.mjs` 的 `ACCOUNT_SERVER`）。

## 部署（待定）

建议放在 Amano，cloudflared 把子域名（例如 `legal.portkey.bond`）指到 `127.0.0.1:4870`，用 WinSW 或计划任务常驻。域名定了以后改 `server/account.mjs` 的 `ACCOUNT_SERVER`。`data/` 要备份（账号库、加密密钥、管理员密码）。
