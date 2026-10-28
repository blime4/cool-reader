# 书间 FOLIO · 万物收藏

在 FOLIO 阅读器基础上，收藏阅读中遇到的植物、动物与鸟类。

## 启动

需要 Windows、Node.js22+。无需安装 npm 依赖。

运行 `npm start`，打开 http://127.0.0.1:4173 。也可以双击项目中的「启动植物志.cmd」或 scripts/launch.cmd（旧文件名保留兼容已安装启动器）。

GitHub Pages 入口：https://blime4.github.io/cool-reader/ 。当前用户首次使用需执行：

    powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\install-protocol.ps1

Pages 只是启动入口，点击按钮通过已注册 folio-plants://start 启动本机固定服务，浏览器可能要求确认打开应用。项目移动后重新注册。卡片、配置和 Obsidian 内容不会上传 GitHub。

## 万物收藏

查询范围可选全部、植物、动物、鸟类；动物范围包含鸟类。候选卡片标注类群、精确/别名/名称片段匹配及来源链接。收藏后可按类群、认识状态、书名或笔记筛选。

类群根据资料源的分类学信息确定，不从名称猜测；未确定的类群显示其他。手动记录时可自行选择类群。旧卡片没有 kind 字段时按植物读取。不同界的同名学名不会被混为一个物种。

iNaturalist 与维基百科 / Wikidata 共同查询，中文俗名可尝试别名（如合欢树→合欢）；名称片段候选会提示核对。维基百科接口在部分网络下可能超时，其他来源结果仍会保留。许可允许的照片保留作者署名，缺图时显示示意占位。

## Obsidian 与可读文件名

项目根目录 config.local.json（被 Git 忽略）：

    {"obsidianVault":"你的库的绝对路径","obsidianFolder":"FOLIO植物志"}

原有管理目录 FOLIO植物志 保留兼容，不移动其他笔记。新卡片使用物种名称作为文件名，例如「金合欢属.md」。稳定 id 保留在 YAML 属性中，与文件名分离。

启动时会把旧 UUID 文件名安全迁移为名称，逐字节保留卡片内容。若名称已经被其他文件占用，不覆盖原文件，而使用「名称 (编号).md」等区分名。非法文件名字符、Windows 保留名及大小写/规范化碰撞都会处理。新文件通过排他创建防止检查后的竞争覆盖。手动在 Obsidian 改名的卡片仍能识别。

网页修改物种名称时会同步调整文件名；覆盖自己的旧版本前会核对内容并存入专用「快照」，发现外部编辑则提示刷新。删除会移入专用「已删除」目录。Markdown 正文的「## 阅读笔记」及缩进保留，可以直接在 Obsidian 编辑。不要删除 id 或 folioPlant 管理标记（旧属性名保留兼容）。

旧 data/plants.json 首次迁移后保留备份，不重复导入。图片在专用「附件」中。迁移整套收藏时复制整个管理文件夹（含附件、快照、已删除、迁移标记）。单独 JSON 备份不含图片二进制文件。

## 开发与检查

    node --test tests/*.test.mjs

- dist/：本地界面与原阅读工作台
- docs/：GitHub Pages 静态启动页
- lib/：查询、分类、本地与 Obsidian 存储
- scripts/：固定路径的本机启动器
- data/、work/、outputs/、config.local.json：不提交、不公开

本地接口只监听回环地址，保留 Host/Origin 校验。启动器不会执行网址传入的命令，也不会结束占用端口的其他程序。
