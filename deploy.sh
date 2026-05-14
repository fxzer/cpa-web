#!/bin/bash

# CLIProxyAPI 本地部署脚本
# 自动打包并复制 management.html 到 CLIProxyAPI static 目录

TARGET_DIR="/opt/homebrew/etc/static"

echo "📦 开始构建..."
npm run build

echo "📋 复制到 $TARGET_DIR..."
cp dist/management.html "$TARGET_DIR/"

echo "✅ 完成！"
echo "文件位置: $TARGET_DIR/management.html"
echo ""
echo "提示：如需重启 CLIProxyAPI 使其生效，运行:"
echo "brew services restart cliproxyapi"
