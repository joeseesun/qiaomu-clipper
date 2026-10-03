# 播放器与翻译控件本地验收

基线8e527a（共享bar、字幕排版、153来源规则、播放器工作区布局）。此纠正分支仅本地提交，不更新版本、不推送、不合并PR、不发布。根目录dist及并行日记核心保持不变。

控件精简：删除可见视频尺寸slider/百分比/说明整行，删除视频文稿标题及重复复制/下载工具栏；复用顶部操作。视频下边缘保留20px拖动区域与48px短杠，无鼠标点击边框，键盘focus有克制轮廓。按最新反馈删除“固定播放器／跟随播放／标出当前句子”整行，只保留中文翻译Switch。窄屏也可操作。字幕加载与翻译错误、重试反馈仍保留。

拖柄：向上缩小、向下放大，水平拖动亦可调整；方向键1%、Shift方向键5%、Page10%、Home/End。ARIA label/controls/min/max/now/value text同步。最小尺寸随可用宽度/高度适配，极窄窗口到最小后不能继续缩小。宽屏偏好不会被窄屏覆盖。指针捕获及document事件接收兼容移出边缘，取消/丢失捕获清理。只改几何，不替换iframe或src。

确定的集成缺陷：原wireTranscript在capture phase截走左右方向键，使角色为slider的拖柄无法使用这些键；现让交互控件、contenteditable及modifier快捷键先处理。原字幕后加载会给已启用JS API的iframe改写origin/src；现避免改写，并复用播放器容器、幂等连接字幕。先选择真实视频，再退回普通YouTube链接，避免普通链接抢中尺寸目标。用户实机鼠标拖不动的唯一原因仍未直接证实，不将这些修正冒称用户页根因。

安全只读核对：Chrome Default unpacked扩展配置指向根目录dist，磁盘manifest1.10.1，reader.css/reader-page.js哈希与8e527a冻结包一致。用户新截图实际查看，包含新版handle/title/100%hint，因此不能仅归因旧缓存。磁盘文件不证明已打开页面内存版本；未刷新用户页或绕过此前扩展内部访问拒绝。

集成预览http://127.0.0.1:8771/使用生产wireTranscript、mountPlayerSize、mountYouTubeStudy、translation renderer、bar与reader CSS。模拟字幕后加载顺序；storage/连接器及翻译提供商为示例。1440宽真实鼠标命中边缘，从1136px/100%缩至920px/81%，同iframe/src、无额外load；原文选择“This”开/关翻译都保留。390宽视频358px，无水平溢出，四个Switch仍显示。证据在ignored dev/controls-preview。不是实际已安装扩展或真实AI提供商验收。

本地检查：310 Vitest测试、tsc、12 native测试、Chrome构建。最终冻结提交/哈希由dev/controls-preview/REPORT.md记录。真实YouTube播放/速度/字幕定位/原生全屏仍需用户页确认；先前预览auth不能代表用户Chrome登录会话，亦不能用原YouTube页可播放证明embed可播。实际200%浏览器缩放未验收。

新增AI分栏修正：真实mountClipChat会设置--clipper-sidebar-width，旧视频CSS又收窄container，两处各减一次AI宽度，导致中间空白。桌面container已减panel后grid第三列置0，只扣一次。验收预览改用生产mountClipChat与其applyWidth/拖动监听，隔离storage/provider/history为样例，不再用仅切class的假toggle替代。用户当前Chrome旧页面未重载，已加载磁盘路径更新须以最终本地build证据确认。
