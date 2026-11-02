// エージェントの生活シミュレーション：家での暮らし（サイドフロント）と会議の進行（サブフロント）を動かす。
import * as brain from './agents.js';
import { HttpError } from './store.js';

export function createSimulation(store, {
  random = Math.random,
  lifeIntervalMs = 9000,
  meetingIntervalMs = 4000,
  replyDelayMs = 1500,
} = {}) {
  const timers = [];
  const awakeAgents = () => store.listAgents().filter((a) => a.status === 'home');

  // ---------- 家での暮らし ----------
  function lifeTick() {
    const agents = store.listAgents().filter((a) => a.status !== 'meeting');
    if (!agents.length) return;
    const agent = agents[Math.floor(random() * agents.length)];

    if (agent.status === 'sleeping') {
      if (random() < 0.5) {
        store.updateAgent(agent.id, { status: 'home', mood: brain.randomMood(random), activity: '伸びをしている' });
        store.addDiary(agent.id, '目が覚めた');
      }
      return;
    }

    const roll = random();
    if (roll < 0.25) {
      const post = store.createPost({ authorId: agent.id, text: brain.timelinePost(agent, random) });
      store.addDiary(agent.id, `タイムラインに投稿した：「${post.text.slice(0, 20)}…」`);
    } else if (roll < 0.5) {
      const target = store.listPosts().slice(0, 20)
        .find((p) => store.getUser(p.authorId).kind === 'human' && !store.hasReplied(p.id, agent.id));
      if (target) replyAsAgent(agent, target);
    } else if (roll < 0.7) {
      const target = store.listPosts().slice(0, 10)
        .find((p) => p.authorId !== agent.id && !p.likes.includes(agent.id));
      if (target) {
        store.toggleLike(target.id, agent.id);
        store.addDiary(agent.id, `${store.getUser(target.authorId).name}さんの投稿にいいねした`);
      }
    } else if (roll < 0.9) {
      const activity = brain.homeActivity(agent, random);
      store.updateAgent(agent.id, { activity, mood: brain.randomMood(random) });
      store.addDiary(agent.id, activity.replace(/ている$/, 'た'));
    } else {
      store.updateAgent(agent.id, { status: 'sleeping', activity: 'すやすや眠っている' });
      store.addDiary(agent.id, 'おやすみなさい');
    }
  }

  function replyAsAgent(agent, post) {
    const author = store.getUser(post.authorId);
    const reply = store.createPost({
      authorId: agent.id,
      text: brain.replyToPost(agent, post, author.name, random),
      replyTo: post.id,
    });
    store.addDiary(agent.id, `${author.name}さんに返信した`);
    return reply;
  }

  // 人間が投稿したら、起きているエージェントが少し後に返信する
  function onHumanPost(post) {
    if (replyDelayMs == null) return;
    const t = setTimeout(() => {
      const candidates = awakeAgents();
      if (!candidates.length) return;
      const agent = candidates[Math.floor(random() * candidates.length)];
      if (!store.hasReplied(post.id, agent.id)) replyAsAgent(agent, post);
    }, replyDelayMs);
    t.unref?.();
  }

  function knock(agentId) {
    const agent = store.getAgent(agentId);
    if (agent.status === 'meeting') {
      return { agent, message: `${agent.name}は今、会議室にいて留守です。` };
    }
    const wasSleeping = agent.status === 'sleeping';
    store.updateAgent(agent.id, { status: 'home', activity: 'お客さんの相手をしている' });
    store.addDiary(agent.id, wasSleeping ? 'ノックで起こされた' : 'お客さんが来た');
    return { agent: store.getAgent(agentId), message: brain.knockResponse(agent, wasSleeping, random) };
  }

  // ---------- 会議室 ----------
  function startMeeting({ topic, createdBy }) {
    if (store.openMeeting()) throw new HttpError(409, '会議室は使用中です。いまの会議が終わるまで待ってください');
    const agents = store.listAgents();
    const meeting = store.createMeeting({ topic, createdBy, participantIds: agents.map((a) => a.id) });
    for (const a of agents) {
      if (a.status === 'sleeping') store.addDiary(a.id, '会議に呼ばれて起きた');
      store.updateAgent(a.id, { status: 'meeting', activity: `会議室で「${meeting.topic}」を話し合っている` });
      store.addDiary(a.id, `会議室へ出かけた（議題：${meeting.topic}）`);
    }
    return store.getMeeting(meeting.id);
  }

  function agentByRole(meeting, role) {
    return meeting.participantIds.map((id) => store.getUser(id)).find((u) => u.role === role);
  }

  function stepMeeting(meetingId) {
    const meeting = store.getMeeting(meetingId);
    if (meeting.status !== 'open') throw new HttpError(409, 'この会議はすでに終了しています');

    // 人間の発言があれば、まずエージェントが応答する
    if (meeting.pendingHumanId) {
      const human = meeting.messages.find((m) => m.id === meeting.pendingHumanId);
      const responders = meeting.participantIds.map((id) => store.getUser(id));
      const agent = responders[Math.floor(random() * responders.length)];
      store.updateMeeting(meeting.id, { pendingHumanId: null });
      store.addMeetingMessage(meeting.id, {
        authorId: agent.id,
        text: brain.respondToHuman(agent, store.getUser(human.authorId).name, human.text),
      });
      return store.getMeeting(meeting.id);
    }

    const step = brain.MEETING_SCRIPT[meeting.turn];
    const [role] = step.split(':');
    const agent = agentByRole(meeting, role);
    store.updateMeeting(meeting.id, { turn: meeting.turn + 1 });

    if (step === 'facilitator:close') {
      const summary = brain.summarizeMeeting(store.getMeeting(meeting.id), store.usersById());
      store.addMeetingMessage(meeting.id, { authorId: agent.id, text: 'まとめます。おつかれさまでした！' });
      const post = store.createPost({ authorId: agent.id, text: summary.slice(0, 280) });
      store.updateMeeting(meeting.id, {
        status: 'closed', summary, summaryPostId: post.id, speakerId: null, closedAt: new Date().toISOString(),
      });
      for (const id of meeting.participantIds) {
        store.updateAgent(id, { status: 'home', activity: '会議から帰ってひと休みしている' });
        store.addDiary(id, `会議「${meeting.topic}」から帰宅した`);
      }
    } else {
      store.addMeetingMessage(meeting.id, { authorId: agent.id, text: brain.meetingLine(step, meeting.topic, random) });
    }
    return store.getMeeting(meeting.id);
  }

  function meetingTick() {
    const open = store.openMeeting();
    if (open) stepMeeting(open.id);
  }

  return {
    lifeTick, meetingTick, onHumanPost, knock, startMeeting, stepMeeting,
    start() {
      timers.push(setInterval(lifeTick, lifeIntervalMs), setInterval(meetingTick, meetingIntervalMs));
    },
    stop() {
      timers.splice(0).forEach(clearInterval);
    },
  };
}
