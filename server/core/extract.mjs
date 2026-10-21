// 抽取：把定稿的消息按小窗交给模型，记下"以后还用得上"的内容。
// 纪律（白皮书 §5.2、调研 24）：只从这条消息里摘；引文逐字核对；谁的说法、当时谁在场由程序填；
// 一条只装一件事；被拦下的也留痕不丢。
import { doorMark } from './door.mjs';
import { DEFAULT_STRIP } from './config.mjs';
import { parseAmount, amountsIn, STAGES } from './money.mjs';
import { factionLedger } from './factions.mjs';
import { KINDS as PROMISE_KINDS, OUTCOMES } from './promises.mjs';
import { LINK_KINDS, similar } from './records.mjs';
import { rankByOverlap } from './recall.mjs';
import { LIFE_KINDS } from './life.mjs';
import { isPrivate } from './visibility.mjs';

import { registerPromptDefaults, promptText } from './prompt-slots.mjs';
export const TYPES = ['说', '心里', '做', '想法', '改变', '时间', '了结', '钱', '关系', '协议', '归属', '立场', '余波'];
const TENSES = ['当时', '现在', '将来'];
const DURATIONS = ['当场', '几天', '几周', '直到被改变', '永久'];
const QUOTE_MAX = 40;

export const SYSTEM_PROMPT = `你在给一部长篇角色扮演做"记账"。这是成年人之间的虚构故事，可能有暴力、伤病、亲密或性的内容；记账只记事实，不复述细节。下面是一小段对话：每条消息带消息号、说话人和当时在场的人。每条消息都是说话人的第一人称：括号里通常是他自己的动作和所见所感，括号外是他说出口的话。

请从"要记的消息"里挑出以后还用得上的内容。少而准：一条记录只装一件事，宁可少记，不要为了省条数把几件事并成一句。寒暄、斗嘴、吃喝坐卧、氛围描写、重复确认都不记；没有值得记的就输出 []。"前文"只帮你看懂上下文，不要从前文里摘录。

每条记录是一个 JSON 对象：
- "消息号"：出自哪条消息（整数）。记录的主人就是那条消息的说话人，不用你填。
- "型"，十三选一：
  "说"——他说出口的内容（引文里得有一段在括号外）：自述、披露、承诺、要求、约定、规矩、对外说辞、对别人的看法；对人立的以后一直照着做的规矩（"别再叫我……""以后……先说一声"），哪怕只是顺口带的一句、和别的事写在同一条里，也单独记一条；
  "心里"——他没说出口、只有自己知道的：括号里的发现、所见、猜测、打算、对别人身体或处境的评价和形容。别人没听见，只记给他自己；
  "做"——他做了一件会有后续的事；他看见别人做的、会有后续的事也算（有人在找什么、谁在盯着谁、谁动了什么），"关于谁"填那个人或势力。披衣服、捡起东西、看了一眼没吱声这类小动作不记，原文里查得到；
  "想法"——有人提出的想法、提议、打算、约好要一起做的事，哪怕是随口一句；
  "改变"——这条消息让某人、某物、某地的状态发生了会持续下去的改变（身上的、处境上的、心里长久的都算：受了伤、搬了家、从此落下了心病；心里一阵子的劲记"余波"）。要有这条消息里发生的事做依据（受了伤、砸了、搬了、定了、弄清了）；说话人对别人身体、处境的揣测、形容、夸张不是改变，记成"心里"或"说"；眼前一时的（眼花一下、头晕一阵）不算，当场就完的不记，事本身记"做"；
  "时间"——这条消息的叙述里，故事当下明确往前走了一段时间（睡了一夜醒来、写明第二天、几天后、具体钟点）；劝人去睡、打算、回忆、假设、交代过去隔了多久都不算——醒来时说起、问起已经过去了多久（"你睡了三天""已经过了一周"），是在交代，不是这条消息里时间往前走了；
  "了结"——这条消息把"还开着的想法和约定"里的某一条做成了、明说不做了、改了日子或做法、或者去办了没成（标着"没讲完"的那几条，这条消息把它接着讲完了也算，结果写"做了"）；"做成了"只算那件事本身办完：出发了、在路上、来接人了、准备去，都还不算；标着"碰上的事""他牵头的事"的那几条，这条消息让它有了着落才了结——解决了、弄清了是怎么回事写"做了"，明说放下不管了写"不做了"；只是提起、问起、还在想办法、试了没成，都不了结（那件事照常记）；标着"来意"的那几条，他这条消息把来意说出来了、或者那件事办了，就了结，结果写"做了"，只是来了、开了口说别的不算；标着"规矩"的那几条里只管那一回的（"检查完了把原话发过来""这次进去把脸板着"），这条消息把那一回办了、过了，也了结，结果写"做了"；一直算数的规矩不了结；
  "钱"——谁给谁钱、多少、到了哪一步（没写明数目的也记，"金额"填"不明"）；泛泛说的行情、价位（"这种活一般两三千""那一带月租一千多"）不是谁和谁之间的钱，不记成"钱"；
  "关系"——说话人和另一个人之间的关系有了实质变化，或者这条消息说清了两人眼下是什么关系：表白、确定关系、第一次亲密、闹翻、和好、结仇、认了家人、从此信任或不再信任；两人之间头一回的也算：吵了一架后头一回服软、一向嘴硬的人头一回开口关心（"外头下雨，开慢点"）、头一回把对方推开、头一回当面说"谢谢"——"内容"写这是头一回怎样，"现在"写从这一刻起说话人这一边对那个人是什么关系（见下）；
  "协议"——两方（人，或公司、帮派、组织、团体这些势力，也包括主角这一伙）之间谈的交换或合作：拿什么换什么、谁替谁办什么、互不侵犯、结盟；谈着的、说定的、正在兑现的、兑现完的、违约的、撕毁的都记，同一笔后来有了进展再记一条；
  "归属"——这条消息让人知道了某人暗地里替谁做事（被拉拢、被策反、安插进去、当了内线），或者某人的归属变了（投靠、叛出、被开除）；平常的"某人是某家的人"不记；
  "立场"——两个势力之间的关系有了变化或被说清：结盟、翻脸、开战、停火、暗中勾结、表面合作。
  "余波"——说话人心里留下了一股要等到某件事才会过去的劲：被对方的话刺到、被推开、被冤枉（等到对方宽慰、道歉、说开）；看到对方难过、受了委屈，他心里揪着、说话做事放轻（等到看见对方好起来）；吃醋、窝火、愧疚、心软、动了心。要这条消息里看得出来（他的话、动作、括号里写的心思）；一时的语气、斗嘴、说笑不记。【还开着的】里已经有他这股劲（标着"心里还没过去的"）、这条只是接着带着、没有新的起因的，不再记，更不往上加多重——只有新的事（又一句难听的话、又一件伤心事）才另记一条。"内容"写成"某某……，心里……"：一句，因为什么、留下了什么劲，不写过程。只记给他自己。
- "内容"：一句话，以人名开头，写成"某某说/某某称/某某答应/某某做了……"的口吻，只写这条消息里有的；不补全、不推测、不升华。人名用对话里的称呼，不用代词开头；场上有同名的人时写清是哪一位。说到的房子、东西、钱是谁的、给谁用的，写明是谁（"给某某租的房子的押金"，不写"新房押金"；"他"指谁不清楚时写名字）。
  单看这一句也得明白（以后它会单独交给前台，前台看不到原文）：答应、认下、拒绝、回答、改掉的是哪件事，写出那件事是什么，不写"这条规矩""那件事""这话"；说到的人写名字，地方、东西写全（谁的、哪儿的、什么来路），不写"那只箱子""那张脸"；气头上、赌气、反话、说着玩的，写明（"某某赌气说……""某某半开玩笑说……"），别写成正经说定的。
- "关于谁"：这条讲的是谁的身体、经历、财物或处境；讲说话人自己就填他自己。
- "到谁手上"：可不填。这条里有东西、话、钱经别人的手送到、带到、转交给了一个当时不在场的人（送货送到他那儿、托人带话、留言、转账、寄过去），填那个人的名字——他那边就算收到了。他在场的不填；只是打算送、还没送出去的不填；托在场的人转告、带话的，话还在那个人手上，不填（等转告的那条再说）。
- "时态"："当时"（讲过去的事）/"现在"（此刻成立）/"将来"（打算、约定、期限）。
- "引"：数组，1～2 段从这条消息里逐字摘出的原文，每段不超过 30 字；不要用省略号把两处拼成一段。
- "检索词"：数组，3～6 个，以后有人提到这件事时可能用到的词：核心概念（事件、症状、地点、物品、关系变化），加上平时说起它的其他说法（同义、口语）。正文里出现的地名、店名、物品名照原样收一个。每个 2～6 个字，不写人名。
- "宽"：数组，2～3 个宽一点的说法，以后有人换了说法、只说到同一类东西或同一种场合时靠它找回来：这件事说的东西属于哪一大类（比如"止痛片"是"药"，"抚恤金"是"赔偿"，"微波炉"是"家电""厨房"），发生在什么日常场合（吃饭、睡觉、看病、打架、住处、钱、出行、工作……）。用最平常的说法，每个 2～4 个字，不重复"检索词"里的。
- "待办"：只有明确的承诺、请求、期限，或者正等着对方答的问题才填 true。
- "分量"：每条都填。"长"——会一直算数的（住哪、会什么本事、道上怎么看他、有人在找什么、谁欠谁、约定、规矩、身体上长久的变化、弄清的真相）；"短"——这几天内才用得上的（今天的安排、一时的情绪、眼下的小事）。
- "提起"：数组，可不填。这条说到的是【已知的】里哪几条（开局前就发生过的事、世界书里写着的人和物），填编号。提起已知的事本身不记；只有说出了设定里没有的新内容、新说法，或者当事人头一回对某人讲起，才记一条并填"提起"——这条账是"他提起了那件事、说了什么"，不是那件事又发生了一遍。
- "不一样"：填了"提起"、而这条说的和已知的那条对不上（时间、数目、谁做的、东西归谁、结局）时填 true——照原文记，不要替它改成已知的说法，也不要替已知的改。
- "过时"：数组，可不填。【已知的】里写的是开场那会儿的情形、到这条就不再成立的，填编号：某人不知道某事，这里有人当面讲给了他；某人以为谁死了，这里见到了活人；两人还没见过面，这里见上了；某人还蒙在鼓里，这里知道了；写着"说不清""没弄清""不知道为什么"的事，这里有人查明了、给出了说法（看了病有了诊断、找到了原因）；标着"压着没说"的，知道的人在这条里当面把它说出口了（只是提起要不要说、旁敲侧击、心里想说不算）。只认这条里真发生了的；只提了一句、没讲明白的不算。
- "接上"：数组，可不填。这条和【还开着的】里某条的关系：{"编号": 数字, "关系": "回答"/"改掉"/"同一件"}。回答＝这条在回答那个问题、答应或推掉那个要求；改掉＝这条说的和那条相反，或把那条换掉了（改了日子或做法、弄清了真相、那个状态结束了：那条以后不再算数）；同一件＝和那条是同一件事、没有新内容（那条已经记过，这条不用再记——只输出带"同一件"的这一条，别的格照填）。问和答、提和改都在这一段里的（【还开着的】里还没有它），"编号"写"本段N"：N＝那条在你这次输出里排第几（从 1 数）。
  证实＝猜的那个人亲眼见到了、或者有人当面告诉了他，他猜对了；否定＝他猜错了（"关系"写"证实"或"否定"）。证实、否定只接【还开着的】里标着"猜的"那几条，而且只在猜的那个人这条里在场、看见听见了的时候接——他不在场，真相照记，不接。
- "约定"（型为"说"或"想法"时加）：这条里有人许下、或者两人说定了一件往后要办的事——说话人自己要办的、"我们""咱们"一起办的、别人开口要他办而他没推掉的——加 {"类": "眼前|定了日子|有条件|畅想", "谁办": ["名字"], "跟谁": ["名字"], "约在": "照原文"}。眼前＝这会儿、等会儿就办；定了日子＝说了哪天、几点、下周这类；有条件＝等某件事成了再办（"等我攒够五千""等他找到零件""等有空"）；畅想＝没准日子也没准条件的往后（"等咱们发达了"）。"约在"照原文抄说到时候的那几个字（"明早九点""等我攒够五千"）。一件约定记一条，几件事说在一起的分开记；"内容"写全为了什么——只是约好几点接人、在哪碰头的，把碰头以后要去办的事写进去（"约好明早九点楼下接她，去诊所做检查"），别只记"在楼下等她"。"谁办"写真正去办那件事的人。说话人吩咐对方、给对方限时去办的（"给你五分钟下楼""明天你去把账结了"），对方还没答应，不是约定：记成要求（"待办"填 true）；对方答应了，在答应的那条记约定；对方明说不去、不办，也不是约定。预判别人会怎样（"明天医生准得给你打针"——说的是第三个人会对谁做什么，哪怕两人到时候也在场）、吓唬人、开玩笑、随口冒的念头、劝别人去做的事，都不是约定；以后一直照着做的规矩用"说好的"，不用这一格。
- "说好的"（型为"说"时加，不是一种型）：这句说定的是两人之间以后一直照着做的规矩——怎么称呼、别再做什么、以后都怎样（"别再叫我……""以后出门先说一声"），或者答应了照这个规矩来——填 true。一次性的请求、当场的吩咐不算。说话人给别人立的规矩（"以后你出门先跟我说一声"），对方没答应，也照样标 true（记下他提过），程序会分清是谁立给谁的。"内容"写出规矩本身——谁对谁、以后怎样（照原话的意思用平话写全）；只抄一句原话、看不出要照着做什么的不行，原话放引文。答应、认下别人立的规矩的那条，写明认的是哪条规矩、内容是什么，并"接上"那条（关系写"回答"）。气头上、赌气说的"以后各走各的"这类，"内容"写明是赌气说的。
- "认错"（不是一种型；型为"说""心里""关系""做"时加）：说话人在这条里认下了自己对某个人做错的一件事——当面认错、道歉，或者心里明白过来自己错在哪——加 {"对谁": "名字", "错在": "他做了什么（一句，照这场戏里的事写）", "后果": "这事惹出了什么：对方怎么了、两人之间怎么了（一句；前文里看得出来就写，看不出来留空）", "情形": ["2～4 个短语：以后什么样的时候他会又走到这一步——当时对方在干什么、他被什么推到了这一步（\"她不肯照他的安排\"\"她病着还硬撑\"\"他急了要替她拿主意\"），也写他那样做时的样子（\"放狠话\"\"不让她走\"）"]}。只记他自己认下了的；别人指责而他不认的、斗嘴玩笑里顺口的"我错了"、客套的"不好意思"不算。
- "受用"（不是一种型；型为"说""做""关系"时加，"心里"的不算——对方得看得出来）：说话人明显很受用另一个人刚做的某件事——当面说出来，或者反应一看就知道（一下子软下来、笑开了、主动凑过去、明说喜欢）——加 {"对谁": "做那件事的人", "做了什么": "一句", "反应": "说话人怎么受用的，一句", "情形": ["2～4 个短语：以后什么样的时候这一手还用得上"]}。平常的道谢、客气、顺口一句"不错"不算；只记明显、具体的。
- "生活现状"（不是一种型；型为"做""改变""钱"时加，"说"里明说已经办成了的也算）：这条让某人的住处或家当有了会一直在的变化——搬了家、换了住处；家里添了、换了、扔了、坏了什么（家具、电器、门窗、供暖、装修）；买了、扔了、穿坏了、送人了衣服（只是换上衣柜里的另一身、脱下来的不算，那是此刻的样子）；添了、丢了随身的东西（乐器、车、终端、武器……）；会一直带着的身体状况有了变化（没好的旧伤好了或加重了、落下了病根、开始或不再靠什么药撑着、身上装了或拆了什么；几天就好的磕碰、累、醉、饿不算，那是"改变"）——加 {"谁": "东西归谁、谁住那儿、是谁的身体", "类": "住处|家里|衣服|东西|身体", "现在": "变了以后是什么，照原文的说法，几个字到一句（\"城东一间带车库的铺子\"\"双人床\"\"黑色短夹克、两件T恤\"\"左手旧伤没好，抬不过肩\"）；扔了、坏了、丢了、（身体的）好了写\"没了\"", "换掉": "被换掉、扔掉、坏掉的那件，没有就空着", "在哪": "\"家里\"的写是哪处住处（\"某人的公寓\"），别的不写"}。只记真办成了的；打算、想买、看中了、还没送到的不算，正在装、施工中的也不算（装好了再记）。当面说、发消息告诉别人家里换了什么、已经办成了的，也在说的那条上记一条——听的人从这儿知道了。
- "编的"：说话人自己表明这套话是编来对外用的，填 true。
- "猜的"（型为"说"或"心里"时加）：说话人对自己没亲眼见到、也没人告诉过他的事下的判断——猜、以为、估计、怀疑、听动静看样子断定（"听这动静，你是没吃上""她八成早走了"）——填 true，"内容"写成"某某猜……""某某以为……"，不要写成那件事本身（不写"某某没吃上"）。拿不准是不是猜的就当猜的；写不成"某某猜……"的宁可不记。
- 说话人是"旁白"的消息：旁白是镜头，不是哪个人，不记旁白说了什么；里面谁做了什么、说了什么，"内容"以那个人开头，并加"谁"（做这件事、说这句话的那个人）。
- 不管是谁的消息，当时在场、看见听见这件事的没卡的人（旁白演的路人、店里的人、来搭话的生人、上门的人），加"旁听"：称呼的数组，照正文里的叫法（"修门的人""酒保"）；正文里没写他在场就不填。
- 型为"改变"时加"持续"："当场"/"几天"/"几周"/"直到被改变"/"永久"，拿不准填"直到被改变"。身体上一时的状况（吐了、疼、晕、发烧、药劲上来、吃不下东西）没说会一直这样的，填"几天"，不填"直到被改变"。
- 型为"时间"时加"过了多久"，照原文说；叙述里写明了这时是一天里的什么时候（早上、中午、傍晚、深夜、几点），加"时段"，照原文写；昏过去又醒来、睡了一觉这类，看不出到底过没过夜、过了多久的，加"拿不准": true。
- 型为"了结"时加"对应"（还开着的想法或约定的编号；想法、约定就在这一段里前面、这次才记的，写"本段N"，同上）和"结果"："做了"／"不做了"（明说不办了）／"改了"（换了日子或做法——新的那件另记一条约定）／"没办成"（去办了没成，或者到时候错过了）。
- 型为"关系"时加"对谁"（另一个人）和"现在"（一句话：从这条消息起，说话人这一边对那个人是什么关系、怎么对待，只照这条消息里说话人自己说的、做的写；平实，不写过程）。一方表白、示好、亲近、提出什么，只是这一方的心意和举动，两人的关系没有因此就变了：对方还没回应就写"对方还没回应"，别写成"两人互相……""两人关系进入……"；只有说话人在这条消息里接受、确认了对方的心意，才写两人一起的关系。
- 型为"协议"时加"双方"（数组，两方的名字：人名或势力名，只写名字）、"经手"（数组，当面谈、答应这笔约定的人；双方写的就是人时不用写）、"名目"（2～8 个字，这笔约定叫什么；同一笔后来再提，用【进行中的约定】里的名目）、"阶段"：谈着（还没答应）/说定（答应了，还没开始兑现）/在办（正在兑现）/了了（两边都兑现完了）/违约（有一方没兑现）/破裂（谈崩了或撕毁了）。
- 型为"余波"时加"对谁"（这股劲冲着谁；没有就不填）、"多重"（照起因算，不照他这条演得多凶算：1＝小，过一会儿就散；2＝明显；3＝重：翻脸、被拒、挑明、认错、生死关头）和"等到"（这股劲要等到什么才过去，一句：对方宽慰他、道歉、说开了；看见对方高兴起来；那件事有了着落）。
- 型为"归属"时加"谁"、"明面"（他对外是哪一方的人）、"实际"（他实际替哪一方做事）；明面、实际都只写那一方的名字（人名或势力名），不写一句话。
- 型为"立场"时加"甲""乙"（两个势力的名字）、"公开"（外人看到的甲对乙的关系，一句）、"实际"（甲对乙实际的关系，一句；和公开一样就照抄）。
- 型为"钱"时加："付款人"、"收款人"（人名，对外付给商家、诊所等就写那个地方或"外人"，看不出来写"不明"）；"金额"（照原文的写法抄，比如"两百万""1,500""三十"，原文带着币种就带上）；"阶段"："报价"（开价、谈价，还没定）/"说定"（答应了，钱还没动）/"付了"（钱已经从付款人到了收款人手上）/"欠着"（借的、垫的、赊的）/"还了"（还欠款）/"花了"（买东西、付给外人）/"得了"（抢来、捡来、赢来的，赏金、卖东西得的——没有付款人也记，"付款人"写"外人"或"不明"）；按月、按年反复付的加"每期"（照原文写，如"每月"）。收款人、付款人是没卡的人时写原文里的叫法（"维修工""摊主"），别一条写叫法、一条写"外人"。

关系有了实质变化要记成"关系"型，"内容"写成一句平实的事实，比如"某某和某某有了亲密关系""两人第一次一起过夜"；不写"性关系""做爱"这类直白的词（记下的话会交给前台模型，直白的词会让它整条拒收），具体过程不写，引文挑不露骨的那句。亲密场面里的调情、情话、身体描写不记，除非说出了以后还会被提起的事（过去的经历、承诺、身体上真实的变化）。

对账：【还开着的】里的问题和要求有了答复，约定被改、被推、被答应，哪怕只是一句"身体还没调过来""你先走吧，我再躺会儿"，也要记一条并"接上"——这不算重复确认。【还开着的】里标着"心里还没过去的"那几条写着等到什么：这一段里那件事发生了（对方宽慰了、道歉了、说开了，看得出对方高兴起来了），或者他自己放下了，哪怕那条消息本来不值得记，也记一条并"接上""改掉"它。
一个状况结束了（伤病好了、药劲过了、修好了、找到了、那件事办完了、那一晚过去了），记下结束的那条时，把【还开着的】里只因为那个状况才有的每一条都"接上""改掉"：为它立的规矩、提的要求、惦记的打算、记着的那个状况本身——不只最像的那一条。人好了不等于两个人之间别的规矩变了，那些不动。

每条要记的消息都过一遍，短的、全在括号里的也一样：括号里发生的事记"做"或"改变"（自己身体的状况、醒来后的样子也算），提出的事照记"想法"，只有自己知道的记"心里"；别只盯着长的那条。

特别注意：角色嘴里对别人经历的概括、猜测、夸张，不是那个人亲口说的经历——要么不记，要么如实记成"某某认为/某某说另一人……"，"关于谁"填那个人。讲到一半停下的经历，只记讲出来的部分；明显还没讲完的（讲到一半停下、被打断、岔开、含糊带过），这条"说"加"没说完": true，"内容"末尾写清停在哪（"……讲到……就没往下说"）。
一个人对他没亲眼见到的事的猜测，永远不要记成那件事本身——要么照"猜的"记成"某某猜……"，要么不记。

另外，"口袋里的事"是幕后排好、由角色挑时候拿出来的事（有的已经在口袋里，有的还排着没到时候）。要记的消息里如果有角色把一件"在口袋里"的拿了出来（照着它做了、说了、让它发生了；只是字面沾边不算；"还排着"的不算露面），另输出一条 {"消息号": 数字, "型": "露面", "对应": "袋编号"}；
如果要记的消息让其中一件已经不成立了（它要催、要办、要等的事已经在别处办完或者黄了，要见的人已经走了、死了，它的前提被推翻了；被角色拿出来、照着办了的算露面，不算作废；发来消息、打来电话、托人带话不等于人来过、见过面），另输出一条 {"消息号": 数字, "型": "作废", "对应": "袋编号", "为什么": "一句"}。只是还没发生、换个时候也还说得通的，不算作废；拿不准就不写。这两种都不用填别的格，不算记录。
不要用原作或任何外部知识补全或纠正这里的设定。只输出一个 JSON 数组，不要任何别的文字；"内容"里要引人说的话时用「」，不要用英文双引号。`;

const extractIntro = '这是成年人之间的虚构故事，可能有暴力、伤病、亲密或性的内容；记账只记事实，不复述细节。';
registerPromptDefaults({ 'extract.intro': extractIntro });
export const extractSystem = (system = SYSTEM_PROMPT, options = {}) => system.replace(extractIntro, promptText('extract.intro', options));
const windowSystem = (config, chatKey) => extractSystem(SYSTEM_PROMPT, config.promptOptionsForChat?.(chatKey) ?? { config });
export function stripper(patterns = DEFAULT_STRIP) {
    const regexes = patterns.map(p => new RegExp(p, 'g'));
    return text => doorMark(regexes.reduce((t, r) => t.replace(r, ''), doorMark(String(text)).text)).text;
}

// 某条消息发生时谁在场：用户＋没被在场区间管着的成员＋在场区间覆盖这条的成员＋这条的说话人。
// remote：这条时隔着电话、消息的人（arrival.remoteWayAt 的 Map 名字→'电话'|'消息'；Set／数组当成消息；场记章程第 2 条）——区间开着也不算当面在场，默认不进；
// 只有这条记的是"说"才算他听见了（他只听得见说出口的，看见的不算）：
//   隔着电话——这条里所有说出口的"说"（谁说的都算，话筒收得到）；隔着消息——只有玩家说的或他自己说的（type、holderName）
export function remoteWays(remote) {
    if (remote instanceof Map) return remote;
    return new Map([...(remote ?? [])].map(n => [n, '消息']));
}
export function presentAt(pos, { members = [], anchors = null, userName = null, speakerName = null, remote = null, type = null, holderName = null }) {
    const names = new Set();
    const far = remoteWays(remote);
    if (userName) names.add(userName);
    for (const m of members) {
        const anchor = anchors?.[m.avatar];
        // to 是他离开后看不到的第一条（隔离扩展离开时记 chat.length）：那一条他不在
        const inside = !anchor || (anchor.segments ?? []).some(s => s.from <= pos && (s.to == null || pos < s.to));
        const hears = !far.has(m.name) || (type === '说' && (far.get(m.name) === '电话' || (!!holderName && (holderName === m.name || holderName === userName))));
        if (inside && m.name && hears) names.add(m.name);
    }
    if (speakerName) names.add(speakerName);
    return [...names];
}

// 待记账的消息：定稿的（后面已经有消息了）、还没记过的、非空的，按连续位置切成小窗。
export function planWindows(messages, isDone, { maxMessages = 8, maxChars = 5000, from = 0 } = {}) {
    const lastPos = messages.length ? messages[messages.length - 1].pos : -1;
    const pending = messages.filter(m => m.pos >= from && m.pos < lastPos && m.text.trim() && !isDone(m.fp));
    const windows = [];
    let current = [], chars = 0;
    for (const m of pending) {
        const gap = current.length && m.pos !== current[current.length - 1].pos + 1;
        if (current.length && (gap || current.length >= maxMessages || chars + m.text.length > maxChars)) {
            windows.push(current); current = []; chars = 0;
        }
        current.push(m); chars += m.text.length;
    }
    if (current.length) windows.push(current);
    return windows;
}

export function estimateCost(windows, { priceInPerM, priceOutPerM }) {
    const promptTokens = 1400, outPerCall = 500, contextChars = 1200;
    let input = 0;
    for (const w of windows) input += promptTokens + Math.ceil((w.reduce((s, m) => s + m.text.length, 0) + contextChars) * 1.4);
    const output = windows.length * outPerCall;
    return { calls: windows.length, inputTokens: input, outputTokens: output, usd: (input * priceInPerM + output * priceOutPerM) / 1e6 };
}

// far：这条时隔着电话、消息的人，Map 名字→方式（不算当面在场：隔着电话听得见这条里所有说出口的，隔着消息只听得见玩家对他说的）
function block(m, clean, presence, far = new Map()) {
    const by = way => [...far].filter(([, w]) => w === way).map(([n]) => n);
    const phone = by('电话'), msg = by('消息');
    return `[消息 ${m.pos}] 说话人：${m.displayName}｜在场：${presence.join('、') || '不明'}${phone.length ? `｜隔着电话：${phone.join('、')}` : ''}${msg.length ? `｜隔着消息：${msg.join('、')}` : ''}\n${clean(m.text)}`;
}

// 势力账的三种记录各自要的格（质量窗 Q-8）；缺了就拦下，理由写清。
const FACTION_KINDS = new Set(['协议', '归属', '立场']);
const DEAL_STAGES = ['谈着', '说定', '在办', '了了', '违约', '破裂'];
function factionOf(type, item) {
    const str = (v, n = 40) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    // 名字后面常带括号注明是哪家的（"某某（某公司）"）：只留名字，不然同一个人对不上。
    const bare = v => str(v).replace(/[（(][^）)]*[）)]/g, '').trim();
    if (type === '协议') {
        const parties = Array.isArray(item?.['双方']) ? [...new Set(item['双方'].map(bare).filter(Boolean))] : [];
        const via = Array.isArray(item?.['经手']) ? [...new Set(item['经手'].map(bare).filter(v => v && !parties.includes(v)))].slice(0, 4) : [];
        const title = str(item?.['名目'], 12), stage = str(item?.['阶段'], 4);
        if (parties.length !== 2) return '协议没写清双方';
        if (!title) return '协议没有名目';
        if (!DEAL_STAGES.includes(stage)) return `协议的阶段不认识：${stage || '空'}`;
        return { parties, title, stage, ...(via.length ? { via } : {}) };
    }
    if (type === '归属') {
        const who = bare(item?.['谁']), pub = bare(item?.['明面']), real = bare(item?.['实际']) || pub;
        if (!who || !pub) return '归属没写清谁、明面';
        return { who, public: pub, real };
    }
    const a = bare(item?.['甲']), b = bare(item?.['乙']), pub = str(item?.['公开'], 120), real = str(item?.['实际'], 120) || pub;
    if (!a || !b || a === b) return '立场没写清甲乙两方';
    if (!pub) return '立场没写外人看到的关系';
    return { a, b, public: pub, real };
}

// deals：进行中的约定（名目要前后一致，同一笔后来有进展时对得上）。
// openItems（对账）：还开着的想法和约定之外，再带上没答的问题和要求、规矩、一直算数的改变、和这段沾边的旧账，每条标着是哪一类；
// 给了它就用它代替 openIdeas 那一段。
export function buildUserPrompt({ window, context, openIdeas, openItems = null, known = [], clean, presenceOf, remoteOf = () => [], onlyTypes = null, pocket = [], deals = [] }) {
    const given = known.length ? `【已知的】（开局单和世界书里本来就有的：角色提起它不算这一局新发生的事，别记成"钱""改变""做"；有新说法、新内容才记，并用"提起"标明是哪条。只写了开头的，按题目认；写全的是和这段最沾边的几条）\n${known.map(k => `已知${k.n}〔${k.tag}${k.title ? '·' + k.title : ''}〕${k.text ? k.text : `${k.brief ?? ''}…`}`).join('\n')}\n\n` : '';
    const tagOf = r => r.tag ?? (r.unfinished ? '没讲完' : r.promise ? `约定${r.promise.when ? `：${r.promise.when}` : ''}` : r.type === '想法' ? '想法' : '');
    const list = openItems ?? openIdeas;
    const ideas = list.length ? list.map(r => `#${r.id} ${r.holder_name ?? r.holder}：${r.text}${tagOf(r) ? `（${tagOf(r)}）` : ''}`).join('\n') : '无';
    const head = openItems ? '【还开着的】（供对照，已经记过的不要再记；这段在回答、改掉、办了哪条，就"接上"或"了结"）' : '【还开着的想法和约定】（供对照，已经记过的不要再记）';
    const farOf = m => new Map([...remoteWays(remoteOf(m.pos))].filter(([n]) => n !== m.displayName));
    const before = context.length ? context.map(m => block(m, t => clean(t).slice(0, 800), presenceOf(m), farOf(m))).join('\n\n') : '无';
    const target = window.map(m => block(m, clean, presenceOf(m), farOf(m))).join('\n\n');
    const only = onlyTypes ? `【这一遍只补记"${onlyTypes.join('"、"')}"型；别的型已经记过了，不要再记。没有就输出 []】\n\n` : '';
    const bag = pocket.length ? `【口袋里的事】（供对照：角色把哪件拿出来了、哪件已经不成立了）\n${pocket.map(m => `袋${m.id}${(m.status ?? 'pocket') === 'pocket' ? '（在口袋里）' : '（还排着）'} ${m.who}「${m.title}」：${String(m.surface ?? '').slice(0, 120)}`).join('\n')}\n\n` : '';
    const pacts = deals.length ? `【进行中的约定】（名目照这里写；有进展才再记）\n${deals.map(d => `${d.parties.join(' 和 ')}「${d.title}」：${d.stage}`).join('\n')}\n\n` : '';
    return `${only}${bag}${pacts}${given}${head}\n${ideas}\n\n【前文】（只供理解）\n${before}\n\n【要记的消息】\n${target}`;
}

// 模型常在字符串里用英文双引号引人说的话，JSON 因此断掉。
// 修法：一个 " 若前面（跳过空白）不是 { [ , : 、后面（跳过空白）也不是 : , } ]，就当作正文里的引号转义掉。
export function repairQuotes(json) {
    let out = '', inString = false;
    for (let i = 0; i < json.length; i++) {
        const c = json[i];
        if (c === '\\' && inString) { out += c + (json[i + 1] ?? ''); i++; continue; }
        if (c !== '"') { out += c; continue; }
        if (!inString) { inString = true; out += c; continue; }
        let j = i + 1;
        while (j < json.length && /\s/.test(json[j])) j++;
        if (j >= json.length || ':,}]'.includes(json[j])) { inString = false; out += c; }
        else out += '\\"';
    }
    return out;
}

export function parseOutput(text) {
    const s = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
    const start = s.indexOf('['), end = s.lastIndexOf(']');
    if (start < 0 || end < start) throw new Error('no_json_array');
    const body = s.slice(start, end + 1);
    let value;
    try { value = JSON.parse(body); } catch { value = JSON.parse(repairQuotes(body)); }
    if (!Array.isArray(value)) throw new Error('not_array');
    return value;
}

// 比引文时不计较空白和引号的样式（模型常把原文的“”写成""，9/29 实测一条"别叫我'大传奇'"因此被拦）。
const squash = t => t.replace(/\s+/g, '').replace(/[“”"„‟＂]/g, '"').replace(/[‘’'＇]/g, "'");

// 检索词：2～10 字、去重、最多 8 个，去掉人名（人名由程序按说话人/在场处理）。
export function cleanKeys(keys, names = []) {
    if (!Array.isArray(keys)) return [];
    const out = [];
    for (const k of keys) {
        if (typeof k !== 'string') continue;
        const key = k.trim().replace(/^[#＃]/, '');
        if (key.length < 2 || key.length > 10 || out.includes(key)) continue;
        if (names.some(n => n && (n.includes(key) || key.includes(n)))) continue;
        out.push(key);
        if (out.length >= 8) break;
    }
    return out;
}

// 超出条数时先留这些：会持续的改变、想法与了结、时间、待办，最后才是一般的说和做。
const PRIORITY = { 改变: 0, 关系: 0, 钱: 0.5, 想法: 1, 了结: 1, 余波: 1.5, 时间: 2, 做: 3, 说: 4 };
const rank = item => (item?.['分量'] === '长' ? -3 : 0) + (PRIORITY[item?.['型']] ?? 5) - (item?.['待办'] === true || item?.['编的'] === true || item?.['说好的'] === true || ['约定', '认错', '受用', '生活现状'].some(k => item?.[k] && typeof item[k] === 'object') ? 2.5 : 0);

// 这段引文在原文里是不是整个在括号里（括号里是动作和心里话，不是说出口的）。两边都已 squash 过。
export function inBrackets(flat, q) {
    const i = flat.indexOf(q);
    if (i < 0) return false;
    let depth = 0;
    const step = c => { if (c === '（' || c === '(') depth++; else if ((c === '）' || c === ')') && depth > 0) depth--; };
    for (let k = 0; k < i; k++) step(flat[k]);
    if (depth <= 0) return false;
    for (const c of q) { step(c); if (depth <= 0) return false; }
    return true;
}

// 逐条核对模型给的记录。持有人、听众由程序填；引文必须逐字出自那条消息。
// onlyTypes：补记某一型时（比如补一遍"钱"），别的型一律不收。
// linkIds：这次给过的【还开着的】编号（"接上"只认这些）；recent：最近看得见的记录（同一个人、字面几乎一样的拦下，不记两遍）。
// "本段N"（这一段里前面刚记的那条，N＝模型这次输出里排第几）→ N；别的写法 → null。
const selfNo = v => { const m = /^\s*本段\s*第?\s*(\d{1,3})\s*条?\s*$/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };

// 这条消息里和一句记录说的最贴近的一句（两字词重合最多、至少三个）：了结没写引文时拿它当引文。
export function closestSentence(body, text) {
    const grams = s => { const out = new Set(); const t = String(s ?? '').replace(/[^一-鿿]/g, ''); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
    const want = grams(text);
    let best = null, score = 2;
    for (const raw of String(body ?? '').split(/(?<=[。！？!?；;\n])/)) {
        const s = raw.replace(/^[\s（(]+|[\s）)]+$/g, '').trim();
        if (s.length < 4) continue;
        const n = [...grams(s)].filter(g => want.has(g)).length;
        if (n > score) { best = s; score = n; }
    }
    return best;
}

// 猜的（用户 10/7：一定防住猜测被写成真的，防不住就宁愿不记）：内容里得看得出是猜的；引文是猜测、内容却写成别人的事的，拦下
const GUESS_WORD = /猜|以为|估计|怀疑|认为|觉得|看样子|料定|想必|推测|判断|八成|多半|恐怕|怕是|准是|看来|兴许|没准/;
const GUESS_CUE = /听这动静|听这声|听动静|听着像|看样子|看这样子|八成|多半|估计|恐怕|想必|怕是|准是|看来|兴许|没准|我猜|猜你|以为你/;
// linkRows：这次给过的【还开着的】各条 {holder, guess}（证实、否定只接猜的那几条，而且猜的那个人得在场）
export function verify(items, { window, clean, presenceOf, remoteOf = () => [], facePresentOf = () => [], openIdeaIds, perMessageCap = 4, windowCap = null, onlyTypes = null, linkIds = new Set(), linkRows = new Map(), recent = [], known = [] }) {
    const knownByN = new Map(known.map(k => [k.n, k]));
    const byPos = new Map(window.map(m => [m.pos, m]));
    const accepted = [], rejected = [];
    const perMessage = new Map(), perLong = new Map();
    const cap = windowCap ?? Math.min(16, 4 + window.length);
    // 字面几乎一样才算（短句里"第一件事""第二件事"这种只差一个字的，不算）。比之前去掉人名和开头的"说/称"——
    // 实测"某某说她没钱了"和"某某说她身上装着个零件"被拉丁字母的人名撑成了"几乎一样"。
    const SAME = 0.7;
    const gist = (t, names) => { let s = String(t ?? ''); for (const n of names) if (n) s = s.split(n).join(''); return s.replace(/^(说|称|答|问|提出|提议)/, '').replace(/[\s\p{P}]/gu, ''); };
    const twice = r => {
        const names = [r.holderName, r.holder, ...r.audience].filter(Boolean);
        const mine = gist(r.text, names);
        return mine.length >= 8 && [...recent, ...accepted].find(o => o !== r && (o.holder === r.holder || o.holder_name === r.holderName) && gist(o.text, names).length >= 8 && similar(gist(o.text, names), mine) >= SAME);
    };
    const ordered = items.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i).map(x => x.item);
    // 模型输出里的次序（applyReply 先拿掉了"露面""作废"，次序记在 __n 上）
    const nOf = new Map(items.map((item, i) => [item, item?.__n ?? i + 1]));
    for (const raw of ordered) {
        // 模型偶尔把"说好的"当成型填（实测）：按"说"＋说好的收
        const item = raw?.['型'] === '说好的' ? { ...raw, 型: '说', 说好的: true } : raw;
        const pos = Number(item?.['消息号']);
        let m = byPos.get(pos);
        const record = {
            fp: m?.fp ?? null, type: item?.['型'], text: typeof item?.['内容'] === 'string' ? item['内容'].trim() : '',
            about: typeof item?.['关于谁'] === 'string' ? item['关于谁'] : null,
            // 到谁手上（用户 10/8）：送到、带给了不在场的人——他那边就收到了（offstage.mjs 替他记一件碰上的事）
            reach: typeof item?.['到谁手上'] === 'string' && item['到谁手上'].trim() ? item['到谁手上'].trim().slice(0, 40) : null,
            tense: TENSES.includes(item?.['时态']) ? item['时态'] : null,
            quotes: Array.isArray(item?.['引']) ? item['引'].filter(q => typeof q === 'string').map(q => q.trim()) : [],
            todo: item?.['待办'] === true, fabricated: item?.['编的'] === true, guess: item?.['猜的'] === true && ['说', '心里'].includes(item?.['型']), standing: item?.['说好的'] === true && ['说', '改变', '关系'].includes(item?.['型']),
            duration: item?.['持续'] ?? null, elapsed: item?.['过了多久'] ?? null,
            unfinished: item?.['没说完'] === true && item?.['型'] === '说',
            clock: item?.['型'] === '时间' && (typeof item?.['时段'] === 'string' && item['时段'].trim() || item?.['拿不准'] === true)
                ? { ...(typeof item['时段'] === 'string' && item['时段'].trim() ? { part: item['时段'].trim().slice(0, 20) } : {}), ...(item['拿不准'] === true ? { unsure: true } : {}) } : null,
            ideaRef: item?.['对应'] != null && selfNo(item['对应']) == null ? Number(String(item['对应']).replace(/^#/, '')) : null,
            selfIdea: selfNo(item?.['对应']),
            outcome: item?.['结果'] ?? null,
            lasting: item?.['分量'] === '长',
            selfLinks: (Array.isArray(item?.['接上']) ? item['接上'] : []).map(l => ({ n: selfNo(l?.['编号']), kind: l?.['关系'] })).filter(l => l.n != null && ['回答', '改掉'].includes(l.kind)),
            links: (Array.isArray(item?.['接上']) ? item['接上'] : []).filter(l => selfNo(l?.['编号']) == null).map(l => ({ to: Number(String(l?.['编号'] ?? '').replace(/^#/, '')), kind: l?.['关系'] })).filter(l => Number.isInteger(l.to) && linkIds.has(l.to)),
            // 提起的已知的事（只认这次给过的编号），存 {key, title}
            // 过时的（开场那会儿的情形到这条不再成立，用户 10/3：讲给他听了，开局单里"他不知道"那条还在递）：存成 {key, title, stale}
            known: (() => {
                const nums = v => [...new Set((Array.isArray(v) ? v : []).map(n => Number(String(n).replace(/^已知/, ''))))].map(n => knownByN.get(n)).filter(Boolean);
                const stale = new Set(nums(item?.['过时']).map(k => k.key));
                const out = nums(item?.['提起']).map(k => ({ key: k.key, title: k.title || (k.text || k.brief || '').slice(0, 30), ...(item?.['不一样'] === true ? { clash: true } : {}), ...(stale.has(k.key) ? { stale: true } : {}) }));
                for (const k of nums(item?.['过时'])) if (!out.some(o => o.key === k.key)) out.push({ key: k.key, title: k.title || (k.text || k.brief || '').slice(0, 30), stale: true });
                return out;
            })(),
            holder: m?.speaker ?? '?', holderName: m?.displayName ?? null, audience: [],
            // 旁白（镜头，N-276）写的消息：记在里面做事、说话的那个人名下（他知道自己做过的事）
            ...(m?.speaker === 'narrator' && typeof item?.['谁'] === 'string' && item['谁'].trim() ? { holder: `name:${item['谁'].trim().slice(0, 40)}`, holderName: item['谁'].trim().slice(0, 40) } : {}),
        };
        // 谁听见、看见了：照这条记的是什么、谁的（隔着电话、消息的人只算玩家和他自己说出口的，presentAt）
        if (m) record.audience = presenceOf(m, record);
        record._n = nOf.get(raw);
        const reject = reason => rejected.push({ record, reason });
        if (!m) { reject('消息号不在要记的消息里'); continue; }
        if (!TYPES.includes(record.type)) { reject(`型不认识：${record.type}`); continue; }
        if (!record.text || record.text.length > 200) { reject('内容为空或过长'); continue; }
        // 引文不在它写的那条、却在这一窗的另一条里：模型把消息号写串了（线上那档一窗四条时实测会）——按引文所在的那条记，持有人、在场跟着换
        const holds = x => { const b = clean(x.text), f = squash(b); return record.quotes.slice(0, 2).some(q => q.length >= 2 && (b.includes(q) || f.includes(squash(q)))); };
        if (record.quotes.length && !holds(m)) {
            const home = window.filter(x => x !== m && holds(x));
            if (home.length === 1) { m = home[0]; Object.assign(record, { fp: m.fp, holder: m.speaker, holderName: m.displayName }); record.audience = presenceOf(m, record); }
        }
        // 旁白不是人，不算知道的人；旁白那条里做事、说话的那个人算（D-170，试玩 10/6：V 当面跟修门的人报了名号，"知道的人"只记了她自己，
        // 局势就不知道消息能从修门的人那儿传出去）。当时在场的没卡的人（"旁听"）也算听见了。
        if (m.speaker === 'narrator') record.audience = record.audience.filter(n => n !== m.displayName);
        const bystanders = (Array.isArray(item?.['旁听']) ? item['旁听'] : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 20)).slice(0, 8);
        record.audience = [...new Set([...record.audience, ...(m.speaker === 'narrator' && record.holderName && record.holderName !== m.displayName ? [record.holderName] : []), ...bystanders])];
        if (['说', '做'].includes(record.type) && !isPrivate(m)) {
            let faces = []; try { faces = facePresentOf(m.pos); } catch {}
            if (Array.isArray(faces)) record.audience = [...new Set([...record.audience, ...faces.filter(n => typeof n === 'string' && n.trim())])];
        }
        // 心里话只有他自己知道
        if (record.type === '心里' || record.type === '余波') record.audience = [record.holderName ?? record.holder];
        // 余波（方案"场记的分量与连续性"D 层）：冲着谁、多重（1～3，没填按 2）；放在 relation 那一格（只有"关系"型的读它当关系）
        if (record.type === '余波') {
            const to = typeof item?.['对谁'] === 'string' ? item['对谁'].trim().replace(/[（(][^）)]*[）)]/g, '').trim().slice(0, 40) : '';
            const w = Number(item?.['多重']);
            const until = typeof item?.['等到'] === 'string' ? item['等到'].trim().slice(0, 60) : '';
            record.relation = { with: to && to !== record.holderName && to !== record.holder ? to : '', weight: [1, 2, 3].includes(w) ? w : 2, ...(until ? { until } : {}) };
            record.about = record.holderName ?? record.holder;
        }
        if (record.type === '改变' && !DURATIONS.includes(record.duration)) record.duration = '直到被改变';
        if (record.type === '改变' && record.duration === '当场') { reject('当场就完的不算改变（事本身记"做"）'); continue; }
        // 对账：和旧账是同一件的不再记一条（模型说的，或者字面几乎一样的）
        const dup = record.links.find(l => l.kind === '同一件');
        if (dup) { reject(`和 #${dup.to} 是同一件`); continue; }
        record.links = record.links.filter(l => LINK_KINDS.includes(l.kind));
        // 接猜测的（证实、否定，或者回答、改掉了一条猜测）：猜的那个人得在这条里——他不在场，真相照记，他的猜测不动
        record.links = record.links.filter(l => {
            const t = linkRows.get(l.to);
            if ((l.kind === '证实' || l.kind === '否定') && !t?.guess) return false;
            return !t?.guess || [record.holderName, record.holder, ...record.audience].includes(t.holder);
        });
        // 了结也可以关【还开着的】里的问题、要求、钱上的事（实测模型拿它关"这顿我请"）
        if (record.type === '了结' && !((record.selfIdea != null || openIdeaIds.has(record.ideaRef) || linkIds.has(record.ideaRef)) && OUTCOMES.includes(record.outcome))) { reject('了结对不上还开着的想法'); continue; }
        // 碰上的事有了着落才关：解决了、弄清了（做了），放下不管了（不做了）；试了没成、改了做法都还开着
        if (record.type === '了结' && linkRows.get(record.ideaRef)?.matter && !['做了', '不做了'].includes(record.outcome)) { reject('碰上的事还没着落，不了结'); continue; }
        // 约定（N-268）：类认得、谁办写了人；办的人里得有说话人或在场的人——只说到不在场的人会怎样的，是预判，不是约定（只去掉这一格，记录照收）
        if (['说', '想法'].includes(record.type) && item?.['约定'] && typeof item['约定'] === 'object') {
            const p = item['约定'];
            const names = v => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 40)).slice(0, 4);
            const doers = names(p['谁办']), here = [record.holderName, record.holder, ...record.audience].filter(Boolean);
            const ours = !doers.length || doers.some(d => /我们|咱们|大家|一起/.test(d) || here.some(h => h === d || h.includes(d) || d.includes(h)));
            // 说话人吩咐别人去办、给别人限时的（"给你五分钟下楼"），对方还没答应，不是约定：办的人里得有说话人自己，或者"我们一起"。
            // 记成等对方答复的要求（试玩 10/3：单方面的令被记成"今天说好的"，前台照着催她、她不照办就训她）。对方答应了，答应的那条再记约定。
            const self = [record.holderName, record.holder].filter(Boolean);
            const mine = !doers.length || doers.some(d => /我们|咱们|大家|一起/.test(d) || self.some(h => h === d || h.includes(d) || d.includes(h)));
            if (PROMISE_KINDS.includes(p['类']) && ours && mine) record.promise = { kind: p['类'], doers: doers.filter(d => !/我们|咱们|大家|一起/.test(d)), with: names(p['跟谁']), when: typeof p['约在'] === 'string' ? p['约在'].trim().slice(0, 40) : '' };
            else if (PROMISE_KINDS.includes(p['类']) && ours && !mine && record.type === '说') record.todo = true;
        }
        // 记住的一回（用户 10/5）：认过的错（他又压着她、吓唬她的时候，该想起上回这么干惹出了什么）、对方明显很受用的一手。
        // 记在学到它的人名下（who）：认错是说话人自己；受用是做那件事的人（得在场看得见）。情形＝以后什么时候用得上（召回时拿它比眼下）。
        // 对谁不能是说话人自己；不合格只去掉这一格，记录照收
        const lessonOf = (key, type) => {
            const l = item?.[key];
            if (!l || typeof l !== 'object' || !type) return null;
            const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
            const to = str(l['对谁'], 40).replace(/[（(][^）)]*[）)]/g, '').trim();
            const did = str(l[key === '认错' ? '错在' : '做了什么'], 100), effect = str(l[key === '认错' ? '后果' : '反应'], 100);
            const when = (Array.isArray(l['情形']) ? l['情形'] : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 16)).slice(0, 4);
            if (!to || !did || to === record.holderName || to === record.holder) return null;
            if (key === '受用' && !record.audience.includes(to)) return null;
            return key === '认错' ? { kind: '错', who: record.holderName, with: to, did, effect, when } : { kind: '好', who: to, with: record.holderName, did, effect, when };
        };
        const lesson = lessonOf('认错', ['说', '心里', '关系', '做'].includes(record.type)) ?? lessonOf('受用', ['说', '做', '关系'].includes(record.type));
        if (lesson) record.lesson = lesson;
        // 生活现状（N-288）：住处、家里、衣服、随身的东西的变化，归谁、变成了什么、换掉了什么、（家里的）是哪处住处。不合格只去掉这一格
        if (['做', '改变', '钱', '说'].includes(record.type) && item?.['生活现状'] && typeof item['生活现状'] === 'object') {
            const l = item['生活现状'], str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
            const who = str(l['谁'], 40).replace(/[（(][^）)]*[）)]/g, '').trim(), kind = str(l['类'], 4), now = str(l['现在'], 80), gone = str(l['换掉'], 40), where = str(l['在哪'], 40);
            if (who && LIFE_KINDS.includes(kind) && (now || gone)) record.life = { who, kind, now, gone, ...(kind === '家里' && where ? { where } : {}) };
        }
        if (onlyTypes && !onlyTypes.includes(record.type)) { reject(`这一遍只记${onlyTypes.join('、')}`); continue; }
        if (record.type === '关系') {
            // 和谁、现在是什么关系都得写出来；不能是说话人自己。
            const other = typeof item?.['对谁'] === 'string' ? item['对谁'].trim().slice(0, 40) : '';
            const now = typeof item?.['现在'] === 'string' ? item['现在'].trim().slice(0, 120) : '';
            if (!other || !now) { reject('关系没写和谁或现在是什么关系'); continue; }
            if (other === record.holderName || other === record.holder) { reject('关系的另一方是说话人自己'); continue; }
            record.relation = { with: other, now };
            record.about = other;
        }
        if (FACTION_KINDS.has(record.type)) {
            const faction = factionOf(record.type, item);
            if (typeof faction === 'string') { reject(faction); continue; }
            record.faction = faction;
            if (record.type === '归属') record.about = faction.who;
            if (record.type === '立场') record.about = faction.a;
        }
        if (record.type === '钱') {
            // 金额必须是原文里真有的数；谁付谁收要写出来；阶段只认六种。
            const raw = String(item?.['金额'] ?? '').trim();
            const amount = parseAmount(raw);
            const name = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : '不明');
            record.money = { from: name(item?.['付款人']), to: name(item?.['收款人']), amount, raw, stage: item?.['阶段'],
                every: typeof item?.['每期'] === 'string' && item['每期'].trim() ? item['每期'].trim().slice(0, 8) : null };
            record.money.monthly = !!record.money.every;
            if (/成(?!交)|%|％|百分之|折|倍/.test(raw)) { reject(`是比例不是金额：${raw}`); continue; }
            // 没写明数目的照记（金额留空，账本上写"数目不明"）；写了数目却认不出、原文里没有的才拦
            const unsaid = !raw || /^(不明|没写|未写|无|未知|不详|[?？])$/.test(raw);
            if (!unsaid && !amount) { reject(`金额认不出：${raw}`); continue; }
            if (amount && !amountsIn(clean(m.text)).has(amount)) { reject(`金额在原文里找不到：${raw}`); continue; }
            if (unsaid) record.money.amount = null;
            if (!STAGES.includes(record.money.stage)) { reject(`钱的阶段不认识：${record.money.stage}`); continue; }
            if (record.money.from === '不明' && record.money.to === '不明') { reject('谁付谁收都不明'); continue; }
        }
        const body = clean(m.text), flat = squash(body);
        const good = [], bad = [];
        // 原文里本来就有省略号时照收；只有在原文里找不到的，才可能是拿省略号把两处拼在一起。
        for (const q of record.quotes.slice(0, 2)) {
            if (q.length >= 2 && (body.includes(q) || flat.includes(squash(q)))) good.push(q.length > QUOTE_MAX ? q.slice(0, QUOTE_MAX) : q);
            else bad.push(q);
        }
        // 了结没写引文（试玩 10/6："某人把水拎回来了"两条都因此被拦，约定一直开着）：在这条里找和它说的最贴近的一句当引文；找不到照旧拦
        if (!good.length && !bad.length && record.type === '了结') { const q = closestSentence(body, record.text); if (q) good.push(q.length > QUOTE_MAX ? q.slice(0, QUOTE_MAX) : q); }
        if (!good.length) {
            const why = !bad.length ? '没有引文'
                : bad.some(q => /…|\.\.\./.test(q)) ? `引文用省略号拼接，原文里找不到：${bad.join(' / ')}`
                : `引文在原文里找不到：${bad.join(' / ')}`;
            reject(why); continue;
        }
        record.quotes = good;
        // 说出口的才记"说"：引文全在括号里的是动作或心里话（用户 10/2：括号里也有砸椅子这种事实，所以只拦"说"，让模型改记成"做"或"心里"）
        if (record.type === '说' && good.every(q => inBrackets(flat, squash(q)))) { reject('引文都在括号里，不是说出口的：动作记"做"，没说出口的记"心里"'); continue; }
        // 猜的：内容得写成"某某猜……"；引文是猜测（听这动静、八成、看样子）而内容写成了别人的事的，看得出是猜的就标上，看不出就不记
        if (record.guess && !GUESS_WORD.test(record.text)) { reject('标了猜的，内容却写成了那件事本身（要写成"某某猜……"）'); continue; }
        if (!record.guess && ['做', '改变', '说', '心里'].includes(record.type) && (record.about ?? '') !== (record.holderName ?? '') && record.quotes.some(q => GUESS_CUE.test(q))) {
            if (GUESS_WORD.test(record.text) && ['说', '心里'].includes(record.type)) record.guess = true;
            else { reject('引文是他的猜测，内容却写成了别人的事——宁愿不记'); continue; }
        }
        const named = [...presenceOf(m), ...remoteWays(remoteOf(m.pos)).keys()];
        record.keys = cleanKeys(item?.['检索词'], named);
        record.wide = cleanKeys(item?.['宽'], named).filter(k => !record.keys.includes(k)).slice(0, 4);
        const same = twice(record);
        if (same) {
            // 这一段里的另一条已经收了：它接上的旧账并到那条上，别跟着丢（实测：两条几乎一样的，只有被拦的那条写了"改掉"）
            if (!same.id && record.links.length) same.links = [...same.links, ...record.links.filter(l => !same.links.some(x => x.to === l.to && x.kind === l.kind))];
            if (!same.id && record.selfLinks.length) same.selfLinks = [...(same.selfLinks ?? []), ...record.selfLinks];
            reject(`和 ${same.id ? `#${same.id}` : '这一段里另一条'}是同一件（字面几乎一样）`); continue;
        }
        // 上限按分量：会一直算数的不占每条消息和这一段的名额（自己至多 6 条），这几天才用得上的照旧
        if (record.lasting) {
            const l = (perLong.get(pos) ?? 0) + 1;
            if (l > 6) { reject('一条消息记得太多'); continue; }
            perLong.set(pos, l);
        } else {
            const n = (perMessage.get(pos) ?? 0) + 1;
            if (n > perMessageCap) { reject('一条消息记得太多'); continue; }
            if (accepted.filter(r => !r.lasting).length >= cap) { reject('这一段记得太多'); continue; }
            perMessage.set(pos, n);
        }
        accepted.push(record);
    }
    // 这一段里先问后答、先说后办的（"本段N"，用户 10/3：问和答记在同一段里接不上——问题一直挂着"还没回音"，答过的又被递成没答；
    // 说好的事当场就办了，过两天被记成"没办就过去了"）：了结对的那条没收、不是开着的那种，了结不收；
    // 接上的、了结的，存成那条在 accepted 里的位置（落账时换成它的记录号）。
    const at = n => accepted.findIndex(o => o._n === n);
    for (const r of accepted.filter(r => r.selfIdea != null)) {
        const t = accepted[at(r.selfIdea)];
        if (!t || t === r || !(t.type === '想法' || t.promise || t.unfinished || t.todo)) { accepted.splice(accepted.indexOf(r), 1); rejected.push({ record: r, reason: '了结对不上还开着的想法' }); }
    }
    for (const r of accepted) {
        if (r.selfIdea != null) r.selfIdea = at(r.selfIdea);
        r.selfLinks = (r.selfLinks ?? []).map(l => ({ at: at(l.n), kind: l.kind })).filter(l => l.at >= 0 && accepted[l.at] !== r);
    }
    return { accepted, rejected };
}

// 已知的（用户 10/2）：开局单和世界书里本来就有的事。角色提起它不是这一局新发生的事——开局前就花掉的钱、早就有的经历，
// 记成"钱""改变"就把设定当成了新事；记账时给和这段沾边的几条，让模型标明"提起"的是哪件。
// setup＝开局单（前史每条 {事, keys}、走向、钱）；lore＝后台收到的 ST 世界书条目（{key, title, text}）。
// 消息上记的"生成这条时酒馆真触发的世界书"（store.currentMessages 带出来的 JSON 数组，"书|uid"）
export const loreKeysOf = m => { try { const v = typeof m?.lore === 'string' ? JSON.parse(m.lore) : m?.lore; return Array.isArray(v) ? v.filter(k => typeof k === 'string') : []; } catch { return []; } };

export function knownItems({ setup = null, lore = [], userName = null } = {}) {
    const out = [];
    const sub = s => String(s ?? '').replace(/\{\{user\}\}/g, userName ?? '玩家').replace(/\s+/g, ' ').trim();
    const list = v => (Array.isArray(v) ? v : v ? [v] : []);
    // 心里压着的事（held.mjs）：知道的人压着不说的，标出来——他说出口了，记账标"过时"，那一格就不再当他压着
    const heldTag = x => (x && typeof x === 'object' && x['处置'] && x['处置'] !== '直说' && list(x['谁知道']).length ? `·压着没说（${list(x['谁知道']).map(sub).join('、')}${x['处置']}）` : '');
    list(setup?.['前史']).forEach((x, i) => { const text = sub(typeof x === 'string' ? x : x?.['事']); if (text) out.push({ key: `setup:前史:${i}`, tag: `开局单·前史${heldTag(x)}`, title: '', text, keys: Array.isArray(x?.keys) ? x.keys : [] }); });
    list(setup?.['走向']).forEach((x, i) => { const text = sub(typeof x === 'string' ? x : [x?.['事'], x?.['本局']].filter(Boolean).join('：')); if (text) out.push({ key: `setup:走向:${i}`, tag: '开局单·走向', title: '', text, keys: [] }); });
    list(setup?.['钱']).forEach((x, i) => { if (x?.['谁'] && x?.['多少'] != null) out.push({ key: `setup:钱:${i}`, tag: '开局单·钱', title: '', text: `开场时${sub(x['谁'])}手上有 ${x['多少']}`, keys: [] }); });
    for (const e of lore ?? []) { const text = sub(e.text); if (text) out.push({ key: `lore:${e.key ?? e.ekey ?? e.title}`, tag: '世界书', title: sub(e.title).slice(0, 24), text, keys: [] }); }
    return out;
}

// 和这一窗沾边的已知的事（至多 max 条，每条截到 len 字）。
// 全部都列（只给开头一句，模型按题目认"提起的是哪件"）；字面最沾边的几条给全文（能看出"不一样"）。
// 按字面比而不按检索词：前史的检索词多是年份、势力名，哪段都沾。
// fired：这几条消息生成时酒馆真触发的世界书条目（"lore:书|uid"；质量窗 10/2：靠字面挑会漏会撞）——一定列、给全文，不占字面挑的名额。
export function knownFor(known, { window, clean, max = 6, len = 360, brief = 40, fired = null }) {
    if (!known?.length) return [];
    const hit = fired ?? new Set(window.flatMap(m => loreKeysOf(m)).map(k => `lore:${k}`));
    const text = window.map(m => clean(m.text)).join('\n');
    const ranked = rankByOverlap(known.filter(k => !hit.has(k.key)).map(k => ({ ...k, text: `${k.title} ${k.text}`, quotes: [], keys: [] })), text, { textToo: true }).filter(x => x.score > 0);
    const top = ranked[0]?.score || 1;
    const full = new Set([...known.filter(k => hit.has(k.key)).map(k => k.key), ...ranked.filter(x => x.score >= top * 0.4).slice(0, max).map(x => x.r.key)]);
    // 沾得少的只给开头一句（至多 30 条），不沾的不列（一局的前史和世界书合起来上百条，全列又贵又乱）；编号照全表，前后几窗对得上
    const any = new Set([...full, ...ranked.filter(x => x.score >= top * 0.1).slice(0, 30).map(x => x.r.key)]);
    return known.map((k, i) => ({ ...k, n: i + 1, brief: k.text.slice(0, brief), text: full.has(k.key) ? k.text.slice(0, len) : '' })).filter(k => any.has(k.key));
}

// 对账要给模型看的【还开着的】：想法和约定、没答的问题和要求、规矩、一直算数的改变、和这段字面沾边的旧账（各有上限）。
// people（窗里开口的人、在场的人）、speakers（窗里开口的人）、user（玩家的名字）给了就只给和这一窗沾边的（记账每次输入大半是这一段，C3）：
//   主人或知道的人里有窗里的人才算"他的"（玩家在每一窗都在，光是"玩家也知道"不算）；
//   想法、约定、没答的问题和要求：字面沾边的给（不论是谁的，别人的想法碰上同一件事也许要接），不沾边的只给最近 NEAR_RECENT 条内记的（免得"接上"接不上）；
//   规矩：窗里开口的人的（主人或知道的人是开口的人），和字面沾边的；
//   一直算数的改变、这几天还没过去的、猜的、碰上了没下文的：他的里头字面沾边的，和最近 3 条。
// 不给 people 就照旧全列（单测、外援用）。
export const NEAR_RECENT = 40;
export function openItemsFor({ records, chatKey, window, clean, people = null, speakers = null, user = null }) {
    const lastPos = window.at(-1)?.pos ?? 0;
    const vis = records.visible(chatKey);
    const tag = (rows, t) => rows.map(r => ({ ...r, tag: typeof t === 'function' ? t(r) : t }));
    const ideas = tag(records.openIdeas(chatKey), r => (r.unfinished ? '没讲完' : r.promise ? `约定${r.promise.when ? `：${r.promise.when}` : ''}` : '想法'));
    const todos = tag(records.openTodos(chatKey, { lastPos }), r => (/[？?]/.test(r.quotes?.join('') ?? '') || /问/.test(r.text) ? '问了没答' : '要求，还没答复'));
    const rules = tag(vis.filter(r => r.standing), '规矩');
    const lasting = tag(vis.filter(r => r.type === '改变' && ['直到被改变', '永久'].includes(r.duration)).slice(-10), '一直算数的改变');
    // 这几天还没过去的（伤没好透、药劲没过）：也给它看，状况结束了好"改掉"（用户 10/7：受伤的状态一直挂着会形成棘轮）
    const lingering = tag(vis.filter(r => r.type === '改变' && ['几天', '几周'].includes(r.duration) && lastPos - r.pos <= 150).slice(-6), '这几天还没过去的');
    // 心里还没过去的（余波）：给它看，当面说开了、被接住了好"改掉"
    const afterglow = tag(vis.filter(r => r.type === '余波' && lastPos - r.pos <= 150).slice(-6), r => `心里还没过去的${r.relation?.until ? `，等到${r.relation.until}` : ''}`);
    // 猜的、还没人证实的（用户 10/7）：给它看，后来证实了、否定了好接上
    const guesses = tag(vis.filter(r => r.guess && !r.closed_by && lastPos - r.pos <= 200).slice(-8), '猜的，没人证实');
    // 碰上了、还没下文的事（用户 10/7）：后台排的事真发生了的；有了着落（解决了、弄清了、放下了）好"了结"
    // 来意（场记章程 B2）：他这回来是为了什么、还没说出口——他说出来了、那件事办了就了结；只是来了、开了口不算
    const matters = tag(vis.filter(r => r.matter && !(r.closed_by && !r.closed_by.kind) && !r.superseded_by).slice(-10), r => (r.matter.kind === '牵头' ? '他牵头的事，还没下文' : r.matter.kind === '来意' ? '来意，他来是为了这个，还没说出口；说了、办了就了结' : '碰上的事，还没下文'));
    const text = window.map(m => clean(m.text)).join('\n');
    if (people) {
        const who = new Set([...people].filter(Boolean)), talkers = new Set([...(speakers ?? [])].filter(Boolean));
        const others = new Set([...who].filter(n => n !== user));
        const holderOf = r => r.holder_name ?? null;
        const aboutThem = (r, set) => (holderOf(r) != null && set.has(holderOf(r))) || (r.audience ?? []).some(n => set.has(n) && n !== user);
        const mine = rows => rows.filter(r => (holderOf(r) != null && who.has(holderOf(r))) || (r.audience ?? []).some(n => others.has(n)));
        const query = [text, ...who].join('\n');
        const everything = vis.filter(r => !['时间', '了结'].includes(r.type));
        const ranked = rankByOverlap(everything, query).filter(x => x.score > 0);
        const near = new Set(ranked.map(x => x.r.id));
        const recently = r => lastPos - r.pos <= NEAR_RECENT;
        const lastFew = (rows, n = 3) => new Set(rows.slice(-n).map(r => r.id));
        const keepIdeas = rows => rows.filter(r => recently(r) || near.has(r.id));
        const keepSticky = rows => { const m = mine(rows), last = lastFew(m); return m.filter(r => near.has(r.id) || last.has(r.id)); };
        const keepRules = rows => rows.filter(r => aboutThem(r, talkers) || (near.has(r.id) && mine([r]).length));
        const chosen = [...keepIdeas(ideas), ...keepIdeas(todos), ...keepRules(rules), ...keepSticky(lasting), ...keepSticky(lingering), ...keepSticky(afterglow), ...keepSticky(guesses), ...keepSticky(matters)];
        const taken = new Set([...ideas, ...todos, ...rules, ...lasting, ...lingering, ...afterglow, ...guesses, ...matters].map(r => r.id));
        const related = tag(ranked.filter(x => !taken.has(x.r.id)).slice(0, 12).map(x => x.r), '旧账');
        const seen = new Set();
        return [...chosen, ...related].filter(r => !seen.has(r.id) && seen.add(r.id)).sort((a, b) => a.pos - b.pos || a.id - b.id);
    }
    const picked = new Set([...ideas, ...todos, ...rules, ...lasting, ...lingering, ...afterglow, ...guesses, ...matters].map(r => r.id));
    const pool = vis.filter(r => !picked.has(r.id) && !['时间', '了结'].includes(r.type));
    const related = tag(rankByOverlap(pool, text).filter(x => x.score > 0).slice(0, 12).map(x => x.r), '旧账');
    // 同一条可能既是要求又是规矩：只列一次（先到先得）
    const seen = new Set();
    return [...ideas, ...todos, ...rules, ...lasting, ...lingering, ...afterglow, ...guesses, ...matters, ...related].filter(r => !seen.has(r.id) && seen.add(r.id)).sort((a, b) => a.pos - b.pos || a.id - b.id);
}

// 跑一个小窗：组提示词 → 调模型 → 核对 → 落账。失败就记失败，不标"已记账"，下次重试。
// 一小窗要问模型的全部东西（提示词、在场的人、开着的想法）。外援包也用它：窗口拿到的输入和模型拿到的一字不差。
// remoteOf(pos)：那条时隔着电话、消息的人（worker 照进场记录算好传进来；不传就当没有）
export function prepareWindow({ records, config, chat, window, context, names, onlyTypes = null, pocket = [], known = [], remoteOf = () => [], facePresentOf = () => [] }) {
    const clean = stripper(config.strip);
    const members = chat.members ? JSON.parse(chat.members) : [];
    const anchors = chat.anchors ? JSON.parse(chat.anchors) : null;
    const presenceOf = (m, rec = null) => presentAt(m.pos, { members, anchors, userName: names.user, speakerName: m.displayName, remote: remoteOf(m.pos), type: rec?.type ?? null, holderName: rec?.holderName ?? null });
    const openIdeas = records.openIdeas(chat.key);
    const speakers = [...new Set(window.map(m => m.displayName).filter(Boolean))];
    const people = [...new Set([...speakers, ...window.flatMap(m => presenceOf(m)), ...window.flatMap(m => [...remoteWays(remoteOf(m.pos)).keys()])])];
    const openItems = openItemsFor({ records, chatKey: chat.key, window, clean, people, speakers, user: names.user });
    const lastPos = window.at(-1)?.pos ?? 0;
    const recent = records.visible(chat.key).filter(r => lastPos - r.pos <= 60);
    const deals = factionLedger(records.visible(chat.key)).deals.filter(d => !['了了', '破裂'].includes(d.stage));
    const givenKnown = onlyTypes ? [] : knownFor(known, { window, clean });
    const user = buildUserPrompt({ window, context, openIdeas, openItems, known: givenKnown, clean, presenceOf, remoteOf, onlyTypes, pocket: onlyTypes ? [] : pocket, deals });
    return { clean, presenceOf, remoteOf, facePresentOf, openIdeas, linkIds: new Set(openItems.map(r => r.id)), linkRows: new Map(openItems.map(r => [r.id, { holder: r.holder_name ?? r.holder, guess: !!r.guess, matter: !!r.matter }])), recent, known: givenKnown, pocketIds: new Set(pocket.filter(m => (m.status ?? 'pocket') === 'pocket').map(m => m.id)), menuIds: new Set(pocket.map(m => m.id)), user, system: windowSystem(config, chat.key) };
}

// 拿到回答以后：解析、核对、落账。模型答的和窗口交回的走同一条路。
export function applyReply({ records, config, chat, window, prepared, jobId, raw, usage = null, onlyTypes = null }) {
    const items = parseOutput(raw);
    // 一大段一条都没记，多半是模型整段放弃（比如碰到敏感内容），不当作"记完了"，让它重试或最终跳过留痕。
    if (!onlyTypes && !items.length && window.length >= 4 && window.reduce((s, m) => s + m.text.length, 0) >= 2000) throw new Error('suspicious_empty');
    // "露面"不是记录：认出哪条角色的消息把口袋里的哪件拿了出来（用户的消息不算；编号得是这次给过的）。
    const shown = items.filter(i => i?.['型'] === '露面').map(i => ({ m: window.find(w => w.pos === Number(i['消息号'])), id: Number(String(i['对应'] ?? '').replace(/^袋/, '')) }))
        .filter(x => x.m && !x.m.is_user && prepared.pocketIds?.has(x.id)).map(x => ({ id: x.id, pos: x.m.pos, fp: x.m.fp }));
    // "作废"：要记的消息让口袋里或排着的哪件已经不成立了（一单已经交了，"催这单"那件就撤掉），记在让它不成立的那条消息上。
    const voided = items.filter(i => i?.['型'] === '作废').map(i => ({ m: window.find(w => w.pos === Number(i['消息号'])), id: Number(String(i['对应'] ?? '').replace(/^袋/, '')), why: String(i['为什么'] ?? '').slice(0, 200) }))
        .filter(x => x.m && (prepared.menuIds ?? prepared.pocketIds)?.has(x.id) && !shown.some(s => s.id === x.id)).map(x => ({ id: x.id, pos: x.m.pos, fp: x.m.fp, why: x.why }));
    items.forEach((x, i) => { if (x && typeof x === 'object') x.__n = i + 1; });
    const { accepted, rejected } = verify(items.filter(i => i?.['型'] !== '露面' && i?.['型'] !== '作废'), { window, clean: prepared.clean, presenceOf: prepared.presenceOf, remoteOf: prepared.remoteOf, facePresentOf: prepared.facePresentOf, openIdeaIds: new Set(prepared.openIdeas.map(r => r.id)), onlyTypes, linkIds: prepared.linkIds, linkRows: prepared.linkRows, recent: prepared.recent, known: prepared.known ?? [] });
    const used = usage ?? { input: 0, output: 0 };
    const e = config.extractor;
    const costUsd = (used.input * e.priceInPerM + used.output * e.priceOutPerM) / 1e6;
    records.finishJob({ jobId, storyId: chat.story_id, fps: window.map(m => m.fp), accepted, rejected, usage: used, costUsd, raw, markDone: !onlyTypes });
    return { jobId, accepted: accepted.length, rejected: rejected.length, costUsd, usage: used, shown, voided };
}

export async function runWindow({ records, client, config, chat, window, context, names, onlyTypes = null, pocket = [], known = [], remoteOf = () => [], facePresentOf = () => [] }) {
    const prepared = prepareWindow({ records, config, chat, window, context, names, onlyTypes, pocket, known, remoteOf, facePresentOf });
    const jobId = records.startJob({ storyId: chat.story_id, chatKey: chat.key, positions: window.map(m => m.pos), model: client.model });
    let raw = null, usage = null;
    try {
        const reply = await client.complete({ system: prepared.system, user: prepared.user });
        raw = reply.text;
        records.setServed?.(jobId, reply.servedModel);
        usage = {
            input: reply.usage.input ?? Math.ceil((prepared.system.length + prepared.user.length) * 1.4),
            output: reply.usage.output ?? Math.ceil(raw.length * 1.4),
        };
        return { ...applyReply({ records, config, chat, window, prepared, jobId, raw, usage, onlyTypes }), measured: reply.usage.input != null };
    } catch (error) {
        const e = config.extractor;
        records.failJob(jobId, error.message, raw, usage ? { usage, costUsd: (usage.input * e.priceInPerM + usage.output * e.priceOutPerM) / 1e6 } : {});
        throw error;
    }
}
