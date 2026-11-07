// 此刻能做的（场记章程第二节第 5 条、B3，用户 10/10："我感觉是认知给角色卡得太死，该有的提示没做到，只做了不该做什么"）：
// 有卡的人那一格以前只有禁令（别回到这儿、别替对方想、看不见那头），没有"此刻能做什么"——隔着电话听见那头有别人，模型不敢写赶过来、问那是谁。
// 这里交代他此刻的处境与尚未说开的事，具体行动由他按自己的性格和处境定。
// 纯程序，不调模型；题材无关。只给有卡的人（旁白不给），放在"这一轮"那块、此刻的样子之后（slot.extrasFor）。
//
// status：'remote'（隔着电话、消息）／'arrived'（刚进场，头两回开口）／'present'（就在这儿）
// way：远程时是'电话'还是'消息'
// intent：他这回的来意还没说出口（matters.mjs 的 INTENT）；matters：他手上有没下文的事

export function optionsFor({ status = 'present', way = '', intent = false, matters = false, userName = '对方', name = '他' } = {}) {
    const where = status === 'remote' ? /电话/.test(way) ? '隔着电话' : '隔着消息' : status === 'arrived' ? '刚到场' : '就在这里';
    const hand = [intent && '还没说出口的来意', matters && '未有着落的事'].filter(Boolean).join('／');
    return [`${name}眼下${where}${hand ? `；尚有${hand}` : ''}。知道的以实际收到、看见和听见的为限；接下来怎么行动，由${name}按自己的性格和处境定。`];
}
