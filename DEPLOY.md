# 部署指南：GitHub Pages + Supabase

## 架构

- **前端**：GitHub Pages（静态站点）
- **后端**：Supabase Edge Function `api`
- **数据库**：Supabase Postgres

## 一、创建 Supabase 项目（需你操作）

1. 打开 https://supabase.com 注册/登录
2. New Project → 记住数据库密码
3. 进入 **Project Settings → API**，复制：
   - Project URL
   - `anon` `public` key
   - `service_role` key（保密，只用于部署函数，不要写进前端）

## 二、把密钥发给我（或你自己在终端执行）

请准备好这 4 项后继续：

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_PASSWORD=       # 管理后台密码，建议自定
```

以及 GitHub：

```
GitHub 用户名=
仓库名=               # 建议：ceping 或 emotion-atlas
```

## 三、我将代你执行（拿到密钥后）

1. 安装/登录 Supabase CLI，关联项目
2. 执行数据库迁移 `supabase db push`
3. 设置函数密钥并部署 Edge Function `api`
4. 创建 GitHub 仓库、推送代码
5. 配置 GitHub Secrets / Pages
6. 触发 Actions 部署，给你线上地址

## 四、本地临时联调（可选）

```bash
cd frontend
cp .env.example .env
# 编辑 .env 填入 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

管理后台路径：`/admin`  
默认管理员密码以 Supabase Secret `ADMIN_PASSWORD` 为准（未设置时为 `admin888`）。
