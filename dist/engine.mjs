export const CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'appearance', label: '外貌', color: '#e4a18e' },
  { id: 'clothing', label: '服饰', color: '#9cab85' },
  { id: 'voice', label: '声音', color: '#a29ac4' },
  { id: 'manner', label: '举止', color: '#d8b771' },
  { id: 'personality', label: '性格', color: '#83aaa5' },
  { id: 'setting', label: '场景', color: '#9cb2bf' },
  { id: 'excerpt', label: '摘录', color: '#b7a993' },
];

const RULES = [
  ['appearance', /眼睛|眼眸|目光|眉|鼻梁|脸庞|面容|脸颊|头发|发梢|鬓角|苍白|红润|皮肤|身形|瘦削|高挑|胡须|\b(?:eyes?|hair|face|cheeks?|pale|slender|beard)\b/giu],
  ['clothing', /衣|裙|外套|衬衫|袖|领口|围巾|纽扣|皮鞋|长靴|帽|\b(?:coat|dress|shirt|sleeves?|scarf|jacket|boots?|hat|wore|wearing)\b/giu],
  ['voice', /声音|嗓音|低声|轻声|耳语|沙哑|呢喃|喊道|喊声|颤声|笑声|语调|\b(?:voice|whisper(?:ed|ing)?|shout(?:ed|ing)?|hoarse|softly|murmur(?:ed)?)\b/giu],
  ['personality', /固执|温柔|勇敢|沉默寡言|耐心|倔强|善良|谨慎|腼腆|开朗|诚实|胆怯|从容|执拗|宽容|\b(?:kind|brave|stubborn|patient|shy|honest|gentle|generous|cautious)\b/giu],
  ['manner', /脚步|走|推开|抬起|抬手|转身|拿起|点头|摇头|蹲|站|坐|伸手|合上|握住|攥|俯身|踱|\b(?:walk(?:ed|ing)?|push(?:ed)?|turn(?:ed)?|nod(?:ded)?|sit|sat|stood|held|reach(?:ed)?)\b/giu],
  ['setting', /海|雨|风|灯光|灯塔|窗|街|巷|山|月|黄昏|清晨|夜色|暮色|晨光|河|树|码头|\b(?:sea|rain|wind|light|shore|window|street|moon|room|morning|night|river|forest)\b/giu],
];

const CHAPTER_HEADING = /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章节回卷部篇](?:[^\n]{0,60})|(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\b[^\n]{0,60})?|(?:序章|序言|前言|引子|楔子|尾声|后记|终章)(?:[\s：:·—-][^\n]{0,40})?)$/iu;
const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛范彭郎鲁韦马苗方俞任袁柳鲍史唐费岑薛雷贺倪汤滕殷罗毕郝邬安常乐于傅皮齐康伍余元卜顾孟平黄穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴宋茅庞纪舒屈项祝董梁杜阮蓝闵季贾路江童颜郭梅林徐邱高夏蔡田胡霍万卢陆莫房程石崔龚陆叶白邓温文丁易乔廖曾钟游赖邢凌尉迟司马上官欧阳诸葛皇甫';
const NON_NAMES = new Set(['许多', '许久', '明白', '明天', '白天', '白色', '声音', '后来', '回头', '一个', '周围', '何必', '何时', '何处', '常常', '章说', '那天']);
const ENGLISH_NON_NAMES = new Set(('The A An And Or But If Then This That These Those There Here He She His Her They Their We Our You Your It Its I My Me To From Of In On At By For With As Is Was Were Are Be Been Being Not No Yes Chapter Part Book One Two Three Four Five Six Seven Eight Nine Ten When What Why How Where Who After Before While However Perhaps Suddenly Once Every Some All').split(' '));

function normalize(text) {
  return String(text ?? '').replace(/^\uFEFF/u, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function sentenceRanges(text) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const boundary = /[。！？!?\n]/u.test(character) || (character === '.' && (index === text.length - 1 || /[\s”’"')\]]/u.test(text[index + 1])));
    if (!boundary) continue;
    while (index + 1 < text.length && /[。！？!?.”’"')\]\n]/u.test(text[index + 1])) index++;
    ranges.push({ start, end: index + 1 });
    start = index + 1;
  }
  if (start < text.length) ranges.push({ start, end: text.length });
  return ranges;
}

function splitChapters(text) {
  const chapters = [];
  let title = '序言';
  let start = 0;
  let sawHeading = false;
  const lines = /[^\n]+/gu;
  for (const match of text.matchAll(lines)) {
    const line = match[0].trim();
    if (!CHAPTER_HEADING.test(line)) continue;
    const previous = text.slice(start, match.index).trim();
    if (previous) chapters.push({ title, text: previous });
    title = line;
    start = match.index + match[0].length;
    sawHeading = true;
  }
  if (sawHeading) {
    const remaining = text.slice(start).trim();
    if (remaining) chapters.push({ title, text: remaining });
    return chapters;
  }
  const ranges = sentenceRanges(text);
  let chapterStart = 0;
  for (const range of ranges) {
    if (range.end - chapterStart < 6000) continue;
    chapters.push({ title: `第 ${chapters.length + 1} 章`, text: text.slice(chapterStart, range.end) });
    chapterStart = range.end;
  }
  if (chapterStart < text.length) chapters.push({ title: `第 ${chapters.length + 1} 章`, text: text.slice(chapterStart) });
  return chapters;
}

function countName(text, name) {
  let count = 0;
  let position = 0;
  while ((position = text.indexOf(name, position)) !== -1) {
    const before = text[position - 1] ?? '';
    const after = text[position + name.length] ?? '';
    if (!/[A-Za-z]/u.test(name[0]) || (!/[A-Za-z]/u.test(before) && !/[A-Za-z]/u.test(after))) count++;
    position += name.length;
  }
  return count;
}

function discoverPeople(text, customNames) {
  const explicit = [...new Set(customNames.map(name => String(name).trim()).filter(name => name.length > 0 && name.length <= 60))].slice(0, 64);
  const candidates = new Set(explicit);
  if (!explicit.length) {
    const chinese = new RegExp(`(?:[${SURNAMES}][\\p{Script=Han}]{1,2}?)(?=(?:(?:轻声|低声|微笑着|笑着|缓缓|轻轻|小声|大声|平静地|认真地)?(?:说|问|答|道|喊|笑了|点头|摇头))|的(?:眼睛|眼眸|声音|头发|外套|脸|手|性格))`, 'gu');
    for (const match of text.matchAll(chinese)) {
      if (!NON_NAMES.has(match[0])) candidates.add(match[0]);
      if (candidates.size >= 128) break;
    }
    const englishCounts = new Map();
    for (const match of text.matchAll(/\b[A-Z][a-z]{1,20}\b/gu)) {
      const name = match[0];
      if (!ENGLISH_NON_NAMES.has(name)) englishCounts.set(name, (englishCounts.get(name) ?? 0) + 1);
    }
    for (const [name, count] of englishCounts) {
      if (count >= 2 && candidates.size < 192) candidates.add(name);
    }
  }
  return [...candidates].map(name => ({ name, count: countName(text, name) }))
    .filter(person => person.count >= (explicit.length ? 1 : 2))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 48);
}

function classify(text) {
  let best = 'excerpt';
  let highest = 0;
  const categories = [];
  for (const [category, pattern] of RULES) {
    pattern.lastIndex = 0;
    let score = 0;
    while (pattern.exec(text)) score++;
    if (score > 0) categories.push(category);
    if (score > highest) {
      highest = score;
      best = category;
    }
  }
  return { category: best, categories: categories.length ? categories : ['excerpt'] };
}

export function analyzeBook(input = {}, customNames = []) {
  if (!input || typeof input !== 'object') throw new Error('无法读取书籍内容。');
  if (!Array.isArray(customNames)) throw new Error('人物名称需要以列表提供。');
  if (input.chapters && (!Array.isArray(input.chapters) || input.chapters.length > 1000)) throw new Error('书籍章节不能超过 1000 章。');
  const rawSize = input.chapters?.length
    ? input.chapters.reduce((sum, chapter) => sum + String(chapter?.text ?? '').length, 0)
    : String(input.text ?? '').length;
  if (rawSize > 2_000_000) throw new Error('书籍过大，请上传 200 万字以内的内容。');
  const provided = input.chapters?.length ? input.chapters.map((chapter, index) => ({
    title: normalize(chapter?.title || `第 ${index + 1} 章`).trim().slice(0, 160),
    text: normalize(chapter?.text).trim(),
  })).filter(chapter => chapter.text) : null;
  const source = provided ? provided.map(chapter => chapter.text).join('\n') : normalize(input.text).trim();
  if ((source.match(/\p{L}/gu) ?? []).length < 20) throw new Error('可读取文字过少，请上传包含至少 20 个文字的书籍内容。');
  const sourceChapters = provided ?? splitChapters(source);
  if (sourceChapters.length > 1000) throw new Error('书籍章节不能超过 1000 章。');
  const people = discoverPeople(source, customNames);
  const pages = [];
  const fragments = [];
  const chapters = sourceChapters.map((chapter, chapterIndex) => {
    const chapterId = `chapter-${chapterIndex + 1}`;
    const chineseCount = (chapter.text.match(/\p{Script=Han}/gu) ?? []).length;
    const pageSize = chineseCount > chapter.text.length * 0.25 ? 550 : 1100;
    const sentences = sentenceRanges(chapter.text);
    const chapterPages = [];
    let pageStart = 0;
    const addPage = end => {
      if (end <= pageStart) return;
      const page = { id: `page-${pages.length + 1}`, text: chapter.text.slice(pageStart, end), chapterId };
      chapterPages.push(page);
      pages.push(page);
      pageStart = end;
    };
    for (const sentence of sentences) {
      if (sentence.end - pageStart > pageSize && sentence.start > pageStart) addPage(sentence.start);
      // A sentence stays on its source page, even when it is unusually long.
      if (sentence.end - pageStart >= pageSize) addPage(sentence.end);
    }
    addPage(chapter.text.length);
    let pageIndex = 0;
    let pageEnd = chapterPages[0]?.text.length ?? 0;
    for (const sentence of sentences) {
      const raw = chapter.text.slice(sentence.start, sentence.end);
      const text = raw.trim();
      if (!/\p{L}/u.test(text)) continue;
      while (sentence.start >= pageEnd && pageIndex < chapterPages.length - 1) {
        pageIndex++;
        pageEnd += chapterPages[pageIndex].text.length;
      }
      fragments.push({
        id: `fragment-${fragments.length + 1}`,
        text,
        ...classify(text),
        people: people.filter(person => countName(text, person.name) > 0).map(person => person.name),
        chapterId,
        pageId: chapterPages[pageIndex].id,
        offset: sentence.start + raw.indexOf(text),
      });
    }
    return { id: chapterId, title: chapter.title, text: chapter.text, pages: chapterPages };
  });
  return {
    title: normalize(input.title || '未命名的书').trim().slice(0, 160) || '未命名的书',
    chapters,
    pages,
    people,
    fragments,
    totalChars: chapters.reduce((sum, chapter) => sum + chapter.text.length, 0),
  };
}

export function filterFragments(book, { person = 'all', category = 'all', chapter = 'all', query = '' } = {}) {
  const search = String(query).trim().toLocaleLowerCase();
  return book.fragments.filter(fragment =>
    (person === 'all' || fragment.people.includes(person)) &&
    (category === 'all' || (fragment.categories ?? [fragment.category]).includes(category)) &&
    (chapter === 'all' || fragment.chapterId === chapter) &&
    (!search || fragment.text.toLocaleLowerCase().includes(search)));
}

export function makeDemoBook() {
  return analyzeBook({ title: '海边来信', chapters: [
    { title: '第一章 · 风把信带来', text: `小城的九月从一场缓慢的海雨开始，旧邮局门口的积水映着一盏没有熄灭的灯。
林舟的眼睛很黑，眉骨下有一道浅浅的疤，像被铅笔轻轻划过。
林舟穿着一件褪色的蓝衬衫，袖口卷起两折，露出被太阳晒深的手腕。
“今天还有信吗？”林舟低声问，嗓音里带着刚醒来的沙哑。
陈晚从木柜后抬起头，把一枚铜钥匙轻轻推到桌边。
陈晚的短发被雨打湿，发梢贴在白皙的脸颊上。
陈晚穿一条米白棉裙，领口别着一枚小小的银色燕子。
陈晚是个耐心的人，她愿意等每一滴墨水在信封上彻底干透。
窗外的梧桐抖落雨水，远处码头的汽笛把天色推得更深。
“有一封，没有寄件人。”陈晚轻声说，声音像纸页翻过去时的摩擦。
林舟伸手接过信，手指停在信封中央那片被盐水晕开的蓝色上。
林舟向来固执，凡是没有答案的事，他都愿意再多等一天。
信上只有一句话：请在潮水退去的时候，替我看看旧灯塔。
街角的钟敲了六下，一群白鸟越过邮局屋顶，朝着海面飞去。` },
    { title: '第二章 · 雨中的旧站台', text: `第二天的清晨，铁轨旁长满细草，废弃站台的顶棚漏下细密的雨。
许远的脸庞被海风吹得粗糙，眼角却有笑起来才出现的细纹。
许远披一件深绿外套，胸前的纽扣换成了不相配的棕色。
“我认得这张纸。”许远的声音很轻，仿佛怕惊醒站台下沉睡的潮水。
许远蹲下身，把旧行李箱从长椅底下拖了出来。
林舟俯身擦去箱盖上的灰，握住那把已经生锈的铜锁。
林舟的手背有几处细小的擦伤，眉间留着一夜未睡的疲惫。
陈晚把围巾系紧，灰色羊毛帽沿上停着一颗透明的雨珠。
陈晚轻声说：“从前有人在这里等过整整一个冬天。”
许远是个善良而谨慎的人，说到别人的往事总要先停顿片刻。
陈晚摇了摇头，合上那本卷边的时刻表，把它贴在胸前。
风沿着空轨道吹来，信号灯藏在浓雾里，像一颗远远亮着的星。
许远说：“那个冬天，每一班车我都记得。”
林舟没有追问，只把铜锁攥在手里，沿着湿滑的石阶慢慢走下去。` },
    { title: '第三章 · 午后的纸页', text: `午后的阳光落在邮局长桌上，浮尘在暖色的光束里缓缓游动。
陈晚的眼睛在逆光里显出琥珀色，睫毛的影子落在信纸边缘。
陈晚换了一件浅黄针织衣，袖口绣着两片歪歪的小叶子。
“这是她的字。”陈晚低声说，语调里有一种克制的惊喜。
林舟把桌上的信件一封封摊开，按邮戳的日期排成很长的一行。
许远坐在窗边，抬手扶了扶老花镜，又把眼镜放回膝头。
许远的头发已经白了大半，鼻梁上的眼镜痕比皱纹更深。
许远的衬衫领口洗得发白，口袋里露出一截红色的铅笔。
林舟是个诚实的人，可面对这封信时，他第一次不知道该怎样回答。
陈晚温柔地看着那行字，像看一只终于落回掌心的小鸟。
“别急着拆最后一封。”许远的嗓音忽然变得沙哑。
林舟点头，把封口完整的信重新放进一只干燥的木匣。
窗台上的玻璃瓶盛着几枝野花，海风带着盐味穿过半开的百叶窗。
陈晚问：“如果信迟到了很久，还算是到达了吗？”` },
    { title: '第四章 · 灯塔的影子', text: `傍晚退潮时，通往灯塔的石堤从海水里一点点露出来。
林舟走在最前面，伸手拉住陈晚，把她带过长满青苔的石缝。
林舟的蓝色外套被风鼓起，衣角像一面迟迟不肯落下的旗。
林舟的脸颊被夕照染红，额前的碎发掠过那道浅疤。
陈晚喊了一声，声音散在空旷的堤岸上，又被浪声轻轻送回来。
许远停下脚步，俯身拾起一枚圆润的白石子，放进口袋。
许远的眼眸在黄昏中显得格外明亮，仿佛藏着许多未寄出的句子。
许远戴着一顶旧毡帽，帽带上有一处被细线缝补的裂口。
陈晚很勇敢，却从不把勇敢说成一件必须让别人知道的事。
“灯很久没有亮过了。”许远低声说，尾音被风拖得很长。
林舟推开铁门，锈蚀的门轴发出一声悠长的叹息。
塔内的楼梯旋向高处，尘土里留着三串深浅不同的脚印。
陈晚把手掌贴在墙上，缓缓抬起头，望见天窗里最后一点金色。
海平线像一封尚未展开的信，静静躺在整座小城的尽头。` },
    { title: '第五章 · 未寄出的冬天', text: `灯塔顶层的房间里放着一张小桌，桌角下压着一本深蓝封皮的日记。
陈晚坐下来，轻轻合上双手，让呼吸先于话语安静下来。
陈晚的脸色有些苍白，嘴角却留着一个很浅的微笑。
陈晚的棉裙沾上了青苔，银色燕子在暮色里像一枚温暖的小月亮。
“她不是没有回来。”陈晚的声音微微颤抖，“她只是换了一种方式。”
许远摘下帽子，低头站在窗前，双手慢慢摩挲着帽沿。
许远曾经固执地以为，等待是一种可以替别人完成的事情。
林舟的目光停在日记边缘，那里画着一盏小小的灯。
林舟脱下外套，搭在陈晚肩上，替她挡住窗缝里钻进来的凉意。
“那么，我们就把这盏灯修好。”林舟轻声说，嗓音终于不再迟疑。
海面升起一层薄雾，小城的灯光一盏接一盏地亮起，像慢慢展开的星图。
陈晚是个宽容的人，她把那一页日记翻过去，没有责怪任何一次迟到。
许远点头，把那枚白石子放在桌上，压住被风掀起的信纸。
窗外最后一只鸟离开了礁石，夜色温柔地盖住通往岸边的路。` },
    { title: '第六章 · 光的回信', text: `第三天的清晨，海水呈现出很淡的蓝，旧灯塔的玻璃终于擦得透亮。
林舟抬起手，把最后一枚螺丝拧紧，然后退后半步看着灯罩。
林舟的眉间舒展开来，眼睛里有一种孩子般专注的光。
林舟穿着那件蓝衬衫，衣袖上的油渍还没来得及洗去。
“试试吧。”许远轻声说，声音比海风还要柔和。
许远的脸庞迎着晨光，眼角的细纹像在微笑。
陈晚披着浅灰围巾，裙摆在木地板上投下一片柔软的影子。
陈晚伸手按下开关，转身握住林舟的手腕，等那一瞬间的回答。
林舟向来倔强，可这一刻，他学会了把自己的期待交给另外两个人。
灯亮起来的时候，窗外的白鸟正从塔边掠过，整个海面忽然有了方向。
陈晚笑了一声，清亮的笑声沿着旋转的楼梯一路落下去。
许远把帽子戴好，俯身拾起桌上的日记，郑重地放回木匣。
“这一次，信应该收到了。”陈晚低声说。
林舟望着远处的小城，耐心地等第一声汽笛从晨雾里传来。
邮局门口，新的信件已经抵达，而那只没有寄件人的信封，被留在了灯光能够照到的地方。` },
  ] }, ['林舟', '陈晚', '许远']);
}
