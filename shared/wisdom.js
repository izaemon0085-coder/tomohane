// 📚 みんなの知恵ぶくろ（ともはね新聞の専用コーナー）
// 面接・社会のしくみ・学校で学ばないことの知恵を、ユーザーからつのる。のった知恵は「エージェントと学ぶ」の教室でもつかう
// 「読者の声」と同じしくみ：のせてもいいチェック・ペンネーム・運営にも名前を出さない・運営が確かめてからのせる・本人はいつでも取り下げ
export const MAX_WISDOM = 200;
export const WISDOM_PER_DAY = 3;
export const WISDOM_SHOW = 30; // 新聞に出す数（新しい順）
export const WISDOM_TOPICS = [
  { id: 'interview', label: '🎤 面接で聞かれたこと', hint: '例：バイトの面接で、週に何日入れるか聞かれた（会社や学校の名前は書かないでね）' },
  { id: 'society', label: '🏛️ 社会に出て知ったこと', hint: '例：はじめての給料明細で、引かれているお金におどろいた' },
  { id: 'school', label: '🎒 学校で教えてほしかったこと', hint: '例：病院に電話するときの言い方' },
  { id: 'help', label: '🕊️ 助かった相談先', hint: '例：〇〇の窓口に電話したら教えてくれた（番号は運営が確かめてからのせます）' },
];
export const WISDOM_TOPIC_IDS = WISDOM_TOPICS.map((t) => t.id);
export const wisdomTopicLabel = (id) => WISDOM_TOPICS.find((t) => t.id === id)?.label ?? '';
