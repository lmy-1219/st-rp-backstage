// 只渲染提示词模板里的称呼；不猜性别，不改用户资料和引文。
export const genderOf = value => value === '男' || value === '女' ? value : null;
export const playerWord = ({ setup = null, name = null } = {}) => genderOf(setup?.玩家性别) === '女' ? '她'
    : genderOf(setup?.玩家性别) === '男' ? '他' : String(name ?? '').trim() || '玩家的角色';
export const personWord = (person, { again = false } = {}) => again && genderOf(person?.gender)
    ? (person.gender === '女' ? '她' : '他') : String(typeof person === 'string' ? person : person?.name ?? '').trim() || '这个人';
export const renderPronouns = (template, { setup = null, name = null, person = null } = {}) => String(template)
    .replaceAll('〔玩家〕', () => playerWord({ setup, name }))
    .replaceAll('〔当事人〕', () => personWord(person));
export function playerContext(store, chatKey) {
    const chat = store.requireChat(chatKey);
    let persona = null;
    try { persona = JSON.parse(store.getMeta?.(`persona:${chatKey}`) ?? 'null'); } catch {}
    const messages = store.currentMessages?.(chatKey) ?? [];
    return { setup: store.setupOf?.(chat.story_id)?.data ?? null,
        name: persona?.name || [...messages].reverse().find(m => m.is_user)?.name || null };
}
