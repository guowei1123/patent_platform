# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [未发布]

## [0.1.0] - 2025-05-27

### 新增
- 支持 Docker 部署，新增多阶段构建的 `Dockerfile` 和 `.dockerignore`
- 新增 GitHub Actions CI 工作流，支持手动触发构建并将 Docker 镜像推送到 GHCR
- 启用 Next.js standalone 输出模式，以适配容器化部署

### 变更
- 在 `package.json` 中新增 `packageManager` 字段

### 修复
- 补充 `@types/adm-zip` 类型声明，修复 TypeScript 类型检查报错
