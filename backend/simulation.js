// エージェントの生活シミュレーション：家での暮らし（サイドフロント）と会議の進行（サブフロント）を動かす。
import * as brain from './agents.js';
import { HttpError, ageGroup } from './store.js';
import { gamesFor, isGameQuestion, recommendFor, gameRecommendReply } from './games.js';
import * as net from './net.js';
import * as kondate from './kondate.js';
import { publishedIssues, threadText, SHINBUNSHA_ID } from '../shared/news.js';

export function createSimulation(store, {
  random = Math.random,
  lifeIntervalMs = 9000,
  meetingIntervalMs = 4000,
  replyDelayMs = 1500,
  clock = () => new Date(),
  netIntervalMs = 15000,
  checkInternet = net.checkInternet,
  lanAddresses = net.lanAddresses,
  readLatestMenu = kondate.readLatestMenu,
  kondateIntervalMs = 20000,
} = {}) {
  const timers = [];
  // 車（ガレージ）とモグ（金庫）は投稿・返事・会議に出てこないので、交流するのは isSocialAgent のキャラだけ
  const socialAgents = () => store.listAgents().filter(brain.isSocialAgent);
  const awakeAgents = () => socialAgents().filter((a) => a.status === 'home');

  // ---------- 家での暮らし ----------
  function lifeTick() {
    const agents = store.listAgents().filter((a) => a.status !== 'meeting');
    if (!agents.length) return;
    const agent = agents[Math.floor(random() * agents.length)];

    if (agent.status === 'sleeping') {
      if (random() < 0.5) {
        store.updateAgent(agent.id, { status: 'home', mood: brain.randomMood(agent, random), activity: '伸びをしている' });
        store.addDiary(agent.id, '目が覚めた');
      }
      return;
    }

    // 車（ガレージ）とモグ（金庫）は自分の持ち場で過ごすだけ（投稿・返事・いいねはしない）
    // モグは回線の見張り番なので眠らない
    if (!brain.isSocialAgent(agent)) {
      if (random() < 0.8 || agent.role === 'network') {
        const activity = brain.homeActivity(agent, random);
        store.updateAgent(agent.id, { activity, mood: brain.randomMood(agent, random) });
        store.addDiary(agent.id, activity.replace(/ている$/, 'た'));
      } else {
        store.updateAgent(agent.id, { status: 'sleeping', activity: brain.restingActivity(agent) });
        store.addDiary(agent.id, agent.role === 'car' ? 'エンジンを止めた' : 'ひと休みした');
      }
      return;
    }

    const roll = random();
    if (roll < 0.15) {
      const post = store.createPost({ authorId: agent.id, text: brain.timelinePost(agent, random) });
      store.addDiary(agent.id, `タイムラインに投稿した：「${post.text.slice(0, 20)}…」`);
    } else if (roll < 0.5) {
      const target = store.listPosts().slice(0, 20)
        .find((p) => !p.table && store.getUser(p.authorId).kind === 'human' && !store.hasReplied(p.id, agent.id)); // カフェはカフェの2人にまかせる
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
      store.updateAgent(agent.id, { activity, mood: brain.randomMood(agent, random) });
      store.addDiary(agent.id, activity.replace(/ている$/, 'た'));
    } else if (agent.role === 'guardian' && isNight()) {
      // 見守り番のフクロウは夜はねむらない
      store.updateAgent(agent.id, { activity: '夜の見張りをしている', mood: '見張り中' });
      store.addDiary(agent.id, '夜の見張りをした。今夜も平和だ');
    } else {
      store.updateAgent(agent.id, { status: 'sleeping', activity: 'すやすや眠っている' });
      store.addDiary(agent.id, 'おやすみなさい');
    }
  }

  function isNight() {
    const h = clock().getHours();
    return h >= 20 || h < 6;
  }

  // その人の最初の投稿か（はじめての人には寄り添い役のシバがあいさつする）
  function isFirstPostOf(post) {
    return store.listPosts().every((p) => p.authorId !== post.authorId || p.createdAt >= post.createdAt);
  }

  function replyAsAgent(agent, post) {
    const author = store.getUser(post.authorId);
    const reply = store.createPost({
      authorId: agent.id,
      text: brain.replyToPost(agent, post, author.name, random, { isFirstPost: !post.replyTo && isFirstPostOf(post) }),
      replyTo: post.id,
    });
    store.addDiary(agent.id, `${author.name}さんに返信した`);
    return reply;
  }

  // 人間の投稿に返事をするキャラを選ぶ。
  // トゲのある言葉→フクロウ（寝ていても起きる）、はじめての投稿・さみしい投稿→シバ、ほかは起きている誰か
  function chooseResponder(post) {
    const roles = brain.preferredResponderRoles(post, { isFirstPost: !post.replyTo && isFirstPostOf(post) });
    const agents = socialAgents();
    for (const role of roles) {
      const agent = agents.find((a) => a.role === role && a.status !== 'meeting');
      if (!agent) continue;
      if (agent.status === 'sleeping' && role === 'guardian') {
        store.updateAgent(agent.id, { status: 'home', activity: '見張りに戻った' });
        store.addDiary(agent.id, 'トゲのある言葉に気づいて飛び起きた');
        return store.getAgent(agent.id);
      }
      if (agent.status === 'home') return agent;
    }
    const candidates = awakeAgents();
    return candidates.length ? candidates[Math.floor(random() * candidates.length)] : null;
  }

  // 「おすすめのゲームは？」には、ゲーム係のシバが一覧とみんなのおすすめから答える（シバがいなければ、起きている誰か）
  function answerGameQuestion(post) {
    const author = store.getUser(post.authorId);
    const shiba = socialAgents().find((a) => a.role === 'companion' && a.status === 'home');
    const agent = shiba ?? awakeAgents()[0];
    if (!agent || store.hasReplied(post.id, agent.id)) return null;
    const rec = recommendFor({
      games: gamesFor(store.listExtGames(), ageGroup(author.birthdate) ?? 'child'),
      recs: store.listGameRecs(), usersById: store.usersById(), user: author,
    });
    const reply = store.createPost({ authorId: agent.id, text: gameRecommendReply(rec, author.name), replyTo: post.id });
    store.addDiary(agent.id, `${author.name}さんにゲームをすすめた`);
    return reply;
  }

  // カフェの投稿：トゲのある言葉はいつもどおりフクロウ。ほかはカフェの2人（はじめての人にはマスターのタヌキ）
  function respondInCafe(post) {
    const author = store.getUser(post.authorId);
    if (brain.isHarsh(post.text)) {
      const agent = chooseResponder(post);
      return agent && !store.hasReplied(post.id, agent.id) ? replyAsAgent(agent, post) : null;
    }
    const cafe = store.listAgents().filter(brain.isCafeAgent);
    const isFirstVisit = store.listPosts().every((p) => p.authorId !== post.authorId || !p.table || p.id === post.id);
    const awake = cafe.filter((a) => a.status === 'home');
    const agent = isFirstVisit
      ? cafe.find((a) => a.role === 'master') // マスターは、はじめてのお客さんには起きてあいさつする
      : awake[Math.floor(random() * awake.length)];
    if (!agent || store.hasReplied(post.id, agent.id)) return null;
    const table = store.getTable(post.table);
    const reply = store.createPost({
      authorId: agent.id,
      text: brain.cafeReply(agent, post, author.name, table.name, random, { isFirstVisit }),
      replyTo: post.id,
    });
    store.addDiary(agent.id, `カフェで${author.name}さんに声をかけた`);
    return reply;
  }

  function respondToHumanPost(post) {
    if (!store.listPosts().some((p) => p.id === post.id)) return null; // 返事をする前に消された投稿には返さない
    if (post.table) return respondInCafe(post);
    if (isGameQuestion(post.text) && !brain.isHarsh(post.text)) return answerGameQuestion(post);
    const agent = chooseResponder(post);
    if (agent && !store.hasReplied(post.id, agent.id)) return replyAsAgent(agent, post);
    return null;
  }

  // 人間が投稿したら、少し後にキャラが返信する
  function onHumanPost(post) {
    if (replyDelayMs == null) return;
    const t = setTimeout(() => respondToHumanPost(post), replyDelayMs);
    t.unref?.();
  }

  // ---------- 回線番のモグ：Wi-Fi とローカル回線を見張って切り替える ----------
  const MOGU = 'agent-mogu';
  function lineStatus() {
    try { return store.getAgent(MOGU).lines ?? null; } catch { return null; }
  }

  async function netTick() {
    let mogu;
    try { mogu = store.getAgent(MOGU); } catch { return null; }
    const internet = await checkInternet();
    const lan = lanAddresses();
    const active = net.chooseLine({ internet, lan });
    const prev = mogu.lines;
    const changed = !prev || prev.active !== active || prev.internet !== internet || prev.lan.join() !== lan.join();
    if (!changed) return prev;
    const lines = { active, internet, lan, checkedAt: clock().toISOString() };
    store.updateAgent(MOGU, {
      lines,
      activity: `${brain.LINE_LABEL[active]} を見張っている`,
      mood: active === 'wifi' ? '見張り中' : 'ちょっとドキドキ',
    });
    if (!prev || prev.active !== active) store.addDiary(MOGU, brain.lineSwitchLine(prev?.active, active));
    return lines;
  }

  // ---------- やりくり献立との連結：新しい献立ができたら、キャラが広場で話題にする ----------
  let latestMenu = null;
  async function kondateTick() {
    const menu = await readLatestMenu();
    if (!menu) return null;
    latestMenu = menu;
    if (store.getMeta('kondateSeenAt') === menu.createdAt) return null; // もう話題にした献立
    store.setMeta('kondateSeenAt', menu.createdAt);
    const today = kondate.todayMenu(menu, clock());
    const total = menu.days.reduce((sum, d) => sum + (Number(d.cost) || 0), 0);
    const talk = brain.kondateTalk({
      today: today && { ...today, dinner: kondate.mainDish(today.dinner) },
      total, days: menu.days.length, period: menu.period || '献立',
    });
    const usable = (id) => { try { return store.getAgent(id).status !== 'meeting'; } catch { return false; } };
    if (!usable(talk.post.agentId)) return null;
    const post = store.createPost({ authorId: talk.post.agentId, text: talk.post.text });
    store.addDiary(talk.post.agentId, 'やりくり献立の新しい献立を広場で紹介した');
    for (const r of talk.replies) {
      if (usable(r.agentId)) store.createPost({ authorId: r.agentId, text: r.text, replyTo: post.id });
    }
    return post;
  }
  function kondateSummary() {
    if (!latestMenu) return { linked: false, url: kondate.YARIKURI_URL };
    const today = kondate.todayMenu(latestMenu, clock());
    return {
      linked: true,
      url: kondate.YARIKURI_URL,
      createdAt: latestMenu.createdAt,
      period: latestMenu.period,
      todayDinner: today ? kondate.mainDish(today.dinner) : null,
    };
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
    const agents = socialAgents(); // 車はガレージで留守番
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

    if (step.endsWith(':close')) {
      const summary = brain.summarizeMeeting(store.getMeeting(meeting.id), store.usersById());
      store.addMeetingMessage(meeting.id, { authorId: agent.id, text: 'よし、まとめよう。結論はタイムラインに投稿しておく。おつかれさま。' });
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

  // ---------- ともはね新聞：出た日に、新聞社が広場にその号のスレッドを立てる（号外もすぐ） ----------
  // plaza があれば、そのキャラが記者として最初に返事をする
  function announceNews() {
    const posted = [];
    for (const issue of [...publishedIssues(clock())].reverse()) {
      if (store.getMeta(`news:${issue.id}`)) continue;
      store.setMeta(`news:${issue.id}`, true);
      const root = store.createPost({ authorId: SHINBUNSHA_ID, text: threadText(issue), thread: true, newsIssueId: issue.id });
      posted.push(root);
      if (issue.plaza) posted.push(store.createPost({ authorId: issue.plaza.by, text: issue.plaza.text, replyTo: root.id }));
    }
    return posted;
  }

  return {
    lifeTick, announceNews, meetingTick, onHumanPost, respondToHumanPost, knock, netTick, lineStatus, kondateTick, kondateSummary, startMeeting, stepMeeting,
    start() {
      timers.push(
        setInterval(lifeTick, lifeIntervalMs),
        setInterval(meetingTick, meetingIntervalMs),
        setInterval(netTick, netIntervalMs),
        setInterval(kondateTick, kondateIntervalMs),
        setInterval(announceNews, 10 * 60 * 1000), // 月曜日になったら、新しい号を告知する
      );
      netTick();
      kondateTick();
      announceNews();
    },
    stop() {
      timers.splice(0).forEach(clearInterval);
    },
  };
}
