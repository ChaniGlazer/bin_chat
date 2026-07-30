// groups.js - קבוצה אחת קבועה ("כולם") שכוללת את כל המשתמשים הרשומים ב-USERS_JSON.
// הודעה לקבוצה נשלחת ב-Push לכולם, וגם כ-TTS לתיבת ימות של כל חבר (שלוחה משותפת קבועה
// DEFAULT_GROUP_YEMOT_EXTENSION, ראו chat.js deliverGroupMessage) - אבל בלי צינתוק.
const db = require('./db');

const DEFAULT_GROUP_NAME = 'כולם';
const DEFAULT_GROUP_YEMOT_EXTENSION = '9';

/** יוצר את הקבוצה הקבועה אם עוד אין אותה, ומוודא שכל המשתמשים חברים בה - נקרא באתחול השרת. */
function ensureDefaultGroup() {
  db.prepare('INSERT OR IGNORE INTO groups (name, yemot_extension) VALUES (?, ?)').run(
    DEFAULT_GROUP_NAME,
    DEFAULT_GROUP_YEMOT_EXTENSION
  );
  // אם הקבוצה כבר נוצרה בעבר (לפני שהיה yemot_extension) - נוודא שהיא מעודכנת
  db.prepare('UPDATE groups SET yemot_extension = ? WHERE name = ? AND yemot_extension IS NULL').run(
    DEFAULT_GROUP_YEMOT_EXTENSION,
    DEFAULT_GROUP_NAME
  );
  const group = db.prepare('SELECT id FROM groups WHERE name = ?').get(DEFAULT_GROUP_NAME);

  const users = db.prepare('SELECT id FROM users').all();
  const addMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)');
  for (const user of users) {
    addMember.run(group.id, user.id);
  }

  return group.id;
}

function findGroupById(id) {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
}

/** הקבוצות שהמשתמש חבר בהן - כרגע תמיד רק "כולם", אבל כתוב כללי לקראת קבוצות נוספות בעתיד. */
function listGroupsForUser(userId) {
  return db
    .prepare(
      `SELECT g.id, g.name FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
       ORDER BY g.name`
    )
    .all(userId);
}

/** חברי קבוצה, חוץ מהשולח - למי לדחוף Push כשנשלחת הודעה (ראו chat.js). */
function listGroupMembersExcept(groupId, excludeUserId) {
  return db
    .prepare(
      `SELECT u.* FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       WHERE gm.group_id = ? AND u.id != ?`
    )
    .all(groupId, excludeUserId);
}

function isMember(groupId, userId) {
  return !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
}

module.exports = {
  ensureDefaultGroup,
  findGroupById,
  listGroupsForUser,
  listGroupMembersExcept,
  isMember,
};
