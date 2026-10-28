# 书间 FOLIO · 植物志

本地植物收纳与阅读卡片。原 FOLIO 阅读器保留，GitHub Pages 提供启动入口。

## 本机运行

需要 Windows、Node.js22+。无需安装 npm 依赖、无需 API 密钥。

运行 `npm start`，打开 http://127.0.0.1:4173 。原阅读器在 /index.html。

双击「启动植物志.cmd」可通过本机启动器后台启动服务。重复启动会先检查已有植物志服务；端口被其他程序占用时会报错，不会杀掉其他程序。

## 从 GitHub Pages 启动

入口：https://blime4.github.io/cool-reader/

先在自己的电脑上执行：

    powershell -NoProfile -File .\scripts\install-protocol.ps1

它在当前用户的注册表中注册 `folio-plants://start`，不需要管理员权限。页面中的「启动本机服务」按钮会由浏览器请求打开本地应用，再启动 Node 服务并打开本地工作台。浏览器可能显示外部应用确认，需要你点击允许。

GitHub Pages 仅提供静态入口，不运行 Node，也无法在未安装启动器的设备上直接启动进程。私有卡片和 Obsidian 内容不会上传 GitHub。入口页面不会跨域读取本机卡片。把项目移动位置后应重新运行安装脚本更新固定路径。

## Obsidian 存储

在项目根目录创建 `config.local.json`（不会提交到 Git）：

    {
      "obsidianVault": "你的 Obsidian 库的绝对路径",
      "obsidianFolder": "FOLIO植物志"
    }

库应包含 .obsidian 文件夹。启动后，既有 data/plants.json 收藏会迁移到库中的专用文件夹，原 JSON 保留作为迁移备份。此后 Markdown 卡片是存储来源；网页和 Obsidian 编辑读取同一份文件。

只管理专用文件夹中由本应用创建的卡片，不改动其他笔记。植物名、学名、来源、标签等保存在 YAML 属性，阅读笔记保存在正文。删除卡片移入专用「已删除」目录，可手动恢复。不要移除卡片的 id 属性或改变专用卡片结构；损坏文件会提示修复，不会悄悄清空。

图片保存在专用附件目录。首次在线查询和下载图片需联网，内置图鉴与已存图片可离线阅读。移动整套收藏时复制整个专用文件夹，不要只复制 Markdown。

未配置 Obsidian 时继续使用 data/plants.json，不会丢失原有卡片。私有数据、个人配置和日志均被 .gitignore 排除。

## 使用

植物名称 → 查询候选 → 确认物种 → 填写书名/章节/页码/笔记 → 收藏。默认书名《看不见的森林》。可编辑、搜索、按认识状态筛选、导出 JSON 备份并合并恢复。

在线查询结合 iNaturalist 与维基百科 / Wikidata；提供常用别名回退（例如合欢树 → 合欢）和带提示的名称片段候选。候选会显示资料来源、匹配方式，并保存引用链接。维基候选需同时有 Wikidata 学名与植物描述证据；不把普通文章或同名动物作为植物卡片。图片仍只使用有明确许可和署名的来源。某个接口超时不影响其他来源结果，警告不会伪装成植物不存在。仍未查到时可手动创建待补充卡片。不是 AI 物种鉴定，不会凭空补造书籍内容。

## 测试

    node --test tests/*.test.mjs

lib/ 为本地存储和查询；dist/ 为本地网页；docs/ 是唯一的 GitHub Pages 发布目录；scripts/ 为本机启动集成。data/、work/、outputs/、config.local.json 不会发布。

