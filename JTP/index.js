const rainRuntime = globalThis.rain;
if (!rainRuntime || !rainRuntime.api || !rainRuntime.api.storage) throw new Error("Discord plugin API unavailable");
const rainStore = rainRuntime.api.storage.createPluginStore("jumptoping", {});
const implementation = (() => {
  "use strict";
  const { metro } = rainRuntime;
  const patcher = rainRuntime.api.patcher;
  const ui = rainRuntime.api.ui;
  const { findByProps, findByStoreName } = metro;
  const { FluxDispatcher, React, ReactNative: RN } = metro.common;

  const BUILD = "v1.0.0";
  const SHEET_KEY = "jump-to-ping";
  const MAX_ROWS = 50;
  const MAX_CHANNELS = 300;
  const PER_CHANNEL = 25;
  const SNIPPET = 140;
  const RED = "#ED4245";
  const ICON_CANDIDATES = ["AtIcon", "MentionIcon", "ChatMarkUnreadIcon", "BellIcon"];

  const unpatches = [];
  const listeners = new Set();
  const captured = new Map();
  let ReadStateStore;
  let MessageStore;
  let UserStore;
  let ChannelStore;
  let GuildStore;
  let ThemeStore;
  let notifyTimer = null;
  let hydrationUnsubscribe = null;
  let loadRequested = false;
  let initialized = false;
  let partsCache = null;
  let iconButtonCache = null;

  const cfg = () => rainStore.useStore.getState();
  const setSetting = (key, value) => rainStore.useStore.getState().updateSettings({ [key]: value });
  const toast = (t) => { try { ui.toasts.showToast(t); } catch (_) {} };
  const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

  /* ---- shared settings design kit (same as the other plugins) ---- */
  function palette() {
    let light = false;
    try { ThemeStore = ThemeStore || findByStoreName("ThemeStore"); light = !!ThemeStore && ThemeStore.theme === "light"; } catch (_) {}
    return light
      ? { text: "#060607", sub: "#5C5E66", bg: "#FFFFFF", card: "#F2F3F5", acc: "#5865F2", accPressed: "#4752C4", blurple: "#5865F2", card2: "rgba(0,0,0,0.045)", chip: "rgba(0,0,0,0.07)", press: "rgba(0,0,0,0.06)", divider: "rgba(0,0,0,0.09)", off: "#B5BAC1" }
      : { text: "#FFFFFF", sub: "#B5BAC1", bg: "#1E1F22", card: "#2B2D31", acc: "#5865F2", accPressed: "#4752C4", blurple: "#5865F2", card2: "rgba(255,255,255,0.06)", chip: "rgba(255,255,255,0.10)", press: "rgba(255,255,255,0.07)", divider: "rgba(255,255,255,0.09)", off: "#4E5058" };
}

  /* ---- shared settings design kit (identical in AML / GPL / QT) ---- */
  const KIT_TILES = {
    lang: ["LanguageIcon", "\u6587", "#5865F2"], paint: ["PaintPaletteIcon", "\u25C9", "#EB459E"], time: ["ClockIcon", "\u25F7", "#E58A00"],
    store: ["ClipboardListIcon", "\u25A3", "#3BA55D"], trash: ["TrashIcon", "\u232B", "#ED4245"], edit: ["PencilIcon", "\u270E", "#F07B3E"],
    shield: ["ShieldIcon", "\u2298", "#80848E"], bell: ["BellIcon", "!", "#E58A00"], at: ["BellIcon", "@", "#ED4245"],
    reply: ["ChatMarkUnreadIcon", "\u21A9", "#5865F2"], search: ["CompassIcon", "\u2315", "#1ABC9C"], chat: ["ChatMarkUnreadIcon", "\u25A4", "#5865F2"],
    plus: ["PlusSmallIcon", "+", "#5865F2"], link: ["LinkIcon", "\u2197", "#3498DB"], test: ["WrenchIcon", "\u25B7", "#9B59B6"],
    star: ["StarIcon", "\u2605", "#D99700"], server: ["PinIcon", "\u25C7", "#3498DB"], power: ["SettingsIcon", "\u25CF", "#43B581"],
    text: ["PencilIcon", "Aa", "#F07B3E"], guide: ["ClipboardCheckIcon", "?", "#5865F2"], gear: ["SettingsIcon", "\u2022", "#80848E"]
  };
  const KIT_RULES = [
    [/^(default|red|orange|gold|green|teal|blue|indigo|purple|pink|gray)$/i, null],
    [/^ghost ping logger$/i, "power"], [/color|appearance/, "paint"], [/notify|alert|toast/, "bell"], [/test/, "test"],
    [/button|position|composer/, "plus"], [/clear|remove/, "trash"],
    [/clock|time|history|retention|keep .* for/, "time"], [/quick|favorite|saved/, "star"],
    [/cache|storage|persist|remember|restart|across/, "store"],
    [/deleted|delete/, "trash"], [/edit/, "edit"], [/ignore/, "shield"], [/mention|everyone|ping/, "at"],
    [/reply|replies/, "reply"], [/filter|search/, "search"], [/jump/, "link"],
    [/translate|translation|google|deepl|language/, "lang"], [/word|term/, "text"], [/server|guild/, "server"],
    [/capture|message|channel|dm/, "chat"], [/enabled|logger/, "power"]
  ];
  const kitAssetCache = new Map();
  function kitAsset(name) {
    const hit = kitAssetCache.get(name);
    if (hit && (hit.id || Date.now() - hit.at < 5000)) return hit.id;
    let id = null;
    try { const r = globalThis.rain; id = (r && r.api && r.api.assets && r.api.assets.findAssetId && r.api.assets.findAssetId(name)) || null; } catch (_) { id = null; }
    kitAssetCache.set(name, { id, at: Date.now() });
    return id;
  }
  function hexA(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return hex;
    const n = Math.round(a * 255).toString(16);
    return "#" + m[1] + (n.length < 2 ? "0" + n : n);
  }
  function settingIconForTitle(title) {
    const text = String(title || "").toLowerCase();
    const match = KIT_RULES.find(([pattern]) => pattern.test(text));
    return match ? match[1] : null;
  }
  function kitIconKey(p) {
    if (!p || p.noIcon) return null;
    if (p.icon && KIT_TILES[p.icon]) return p.icon;
    return settingIconForTitle(p.title);
  }
  function KitChevron(p) {
    const h = React.createElement, s = p.size || 8, deg = p.dir === "up" ? "225deg" : p.dir === "right" ? "-45deg" : "45deg";
    return h(RN.View, { style: { width: s, height: s, borderRightWidth: 2, borderBottomWidth: 2, borderColor: p.color, borderRadius: 1, transform: [{ rotate: deg }], marginTop: p.dir === "up" ? 3 : p.dir === "down" ? -3 : 0, marginHorizontal: 3 } });
  }
  function KitTile(p) {
    const h = React.createElement, t = KIT_TILES[p.k] || KIT_TILES.gear, size = p.size || 32, asset = kitAsset(t[0]);
    const inner = Math.round(size * 0.56);
    return h(RN.View, { style: { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: t[2], alignItems: "center", justifyContent: "center", marginRight: p.noMargin ? 0 : 13 } },
      asset ? h(RN.Image, { source: asset, resizeMode: "contain", style: { width: inner, height: inner, tintColor: "#FFFFFF" } })
        : h(RN.Text, { style: { color: "#FFFFFF", fontSize: Math.round(size * 0.5), fontWeight: "700" } }, t[1]));
  }
  function CustomSection(p) {
    const C = palette(), h = React.createElement;
    const kids = React.Children.toArray(p.children);
    const any = kids.some((k) => k && k.type === CustomRow && kitIconKey(k.props));
    const isAction = (k) => !!k && k.type === CustomAction;
    if (kids.length && kids.every(isAction)) {
      return h(RN.View, { style: { marginBottom: p.title ? 24 : 12 } },
        p.title ? h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginHorizontal: 6, marginBottom: 10 } },
          h(RN.View, { style: { width: 3, height: 14, borderRadius: 2, backgroundColor: C.blurple, marginRight: 8 } }),
          h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontSize: 15, fontWeight: "700", flexShrink: 1 } }, p.title)) : null,
        ...kids.map((k, i) => React.cloneElement(k, { top: i === 0 ? 0 : 10 })));
    }
    const out = kids.map((k, i) => isAction(k)
      ? h(RN.View, { key: "act-" + i, style: { paddingHorizontal: 12, paddingTop: i === 0 ? 12 : 0, paddingBottom: 12 } }, React.cloneElement(k, { top: 0 }))
      : (k && k.type === CustomRow && any && !k.props.noIcon && !kitIconKey(k.props)) ? React.cloneElement(k, { __fallbackIcon: true }) : k);
    return h(RN.View, { style: { marginBottom: p.compact ? 14 : 24 } },
      p.title ? h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginHorizontal: 6, marginBottom: 10 } },
        h(RN.View, { style: { width: 3, height: 14, borderRadius: 2, backgroundColor: C.blurple, marginRight: 8 } }),
        h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.1, flexShrink: 1 } }, p.title)) : null,
      h(RN.View, { style: { backgroundColor: C.card, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: C.card2 } }, ...out),
      p.footer ? h(RN.Text, { style: { color: C.sub, fontSize: 12, lineHeight: 17, marginHorizontal: 8, marginTop: 8 } }, p.footer) : null);
  }
  function CustomRow(p) {
    const C = palette(), h = React.createElement;
    const key = p.__fallbackIcon ? (kitIconKey(p) || "gear") : kitIconKey(p);
    const tile = key ? KitTile({ k: key, size: 34 }) : null;
    return h(RN.Pressable, {
      accessibilityRole: p.onPress ? "button" : undefined, onPress: p.onPress, disabled: !p.onPress,
      style: ({ pressed }) => ({ minHeight: 66, paddingHorizontal: 16, paddingVertical: 13, flexDirection: "row", alignItems: "center", backgroundColor: pressed ? C.press : "transparent" })
    },
      tile,
      h(RN.View, { style: { flex: 1, minWidth: 0, paddingRight: 10 } },
        h(RN.Text, { numberOfLines: 2, style: { color: C.text, fontSize: 16, fontWeight: "600", lineHeight: 21 } }, p.title),
        p.subtitle ? h(RN.Text, { numberOfLines: 3, style: { color: C.sub, fontSize: 13, marginTop: 3, lineHeight: 18 } }, p.subtitle) : null),
      p.trailing || null,
      !p.last ? h(RN.View, { style: { position: "absolute", bottom: 0, left: key ? 63 : 16, right: 0, height: 1, backgroundColor: C.card2 } }) : null);
  }
  function CustomSwitch(p) {
    const C = palette(), h = React.createElement, on = !!p.value;
    const pos = React.useRef(new RN.Animated.Value(on ? 1 : 0)).current;
    React.useEffect(() => {
      RN.Animated.spring(pos, { toValue: on ? 1 : 0, speed: 24, bounciness: 5, useNativeDriver: true }).start();
    }, [on]);
    return h(RN.Pressable, { accessibilityRole: "switch", accessibilityState: { checked: on }, onPress: () => p.onChange(!on), hitSlop: 10,
      style: { width: 52, height: 32, borderRadius: 16, padding: 3, justifyContent: "center", backgroundColor: on ? (p.color || C.blurple) : C.off } },
      h(RN.Animated.View, { style: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFFFFF", shadowColor: "#000000", shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2, transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] } }));
  }
  function CustomAction(p) {
    const C = palette(), h = React.createElement, RED_ = "#ED4245";
    const sc = React.useRef(new RN.Animated.Value(1)).current;
    const to = (v) => RN.Animated.spring(sc, { toValue: v, speed: 40, bounciness: 0, useNativeDriver: true }).start();
    const bg = p.danger ? (p.secondary ? hexA(RED_, 0.14) : RED_) : (p.secondary ? C.chip : C.blurple);
    const fg = p.danger && p.secondary ? RED_ : (p.secondary ? C.text : "#FFFFFF");
    return h(RN.Pressable, { onPress: p.onPress, disabled: p.disabled, onPressIn: () => to(0.97), onPressOut: () => to(1), accessibilityRole: "button" },
      h(RN.Animated.View, { style: { minHeight: p.compact ? 42 : 50, borderRadius: 15, alignItems: "center", justifyContent: "center", paddingHorizontal: p.compact ? 12 : 18, marginTop: p.top != null ? p.top : 10, backgroundColor: bg, opacity: p.disabled ? 0.45 : 1, transform: [{ scale: sc }] } },
        h(RN.Text, { numberOfLines: 1, style: { color: fg, fontWeight: "700", fontSize: p.compact ? 15 : 16 } }, p.title)));
  }
  function CustomInput(p) {
    const C = palette(), h = React.createElement;
    const [focused, setFocused] = React.useState(false);
    return h(RN.TextInput, {
      ...p, placeholderTextColor: C.sub, underlineColorAndroid: "transparent", textAlignVertical: p.multiline ? "top" : "center",
      onFocus: (e) => { setFocused(true); if (p.onFocus) p.onFocus(e); },
      onBlur: (e) => { setFocused(false); if (p.onBlur) p.onBlur(e); },
      style: [{ minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: focused ? C.blurple : C.card2, backgroundColor: C.bg, color: C.text, paddingHorizontal: 15, fontSize: 16 }, p.style]
    });
  }
  let kitHeroPlayed = false;
  function KitHero(p) {
    const C = palette(), h = React.createElement, accent = p.accent || C.blurple;
    const stats = (p.stats || []).filter(Boolean);
    const enter = React.useRef(new RN.Animated.Value(kitHeroPlayed ? 1 : 0)).current;
    React.useEffect(() => { if (kitHeroPlayed) return; kitHeroPlayed = true; RN.Animated.spring(enter, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: true }).start(); }, []);
    return h(RN.Animated.View, { style: { borderRadius: 26, backgroundColor: C.card, borderWidth: 1, borderColor: hexA(accent, 0.4), padding: 18, marginBottom: 24, overflow: "hidden", opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] } },
      h(RN.View, { pointerEvents: "none", style: { position: "absolute", top: -60, right: -50, width: 190, height: 190, borderRadius: 95, backgroundColor: hexA(accent, 0.16) } }),
      h(RN.View, { pointerEvents: "none", style: { position: "absolute", bottom: -70, left: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: hexA(accent, 0.08) } }),
      h(RN.View, { style: { flexDirection: "row", alignItems: "center" } },
        KitTile({ k: p.icon, size: 54, noMargin: true }),
        h(RN.View, { style: { flex: 1, marginLeft: 14 } },
          h(RN.Text, { numberOfLines: 2, style: { color: C.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.2 } }, p.title),
          p.subtitle ? h(RN.Text, { numberOfLines: 2, style: { color: C.sub, fontSize: 14, marginTop: 3, lineHeight: 19 } }, p.subtitle) : null)),
      stats.length ? h(RN.View, { style: { flexDirection: "row", marginTop: 16 } }, ...stats.map((s, i) =>
        h(RN.View, { key: "stat-" + i, style: { flex: 1, borderRadius: 15, backgroundColor: C.chip, paddingVertical: 11, paddingHorizontal: 12, marginRight: i === stats.length - 1 ? 0 : 8 } },
          h(RN.Text, { numberOfLines: 1, adjustsFontSizeToFit: true, style: { color: C.text, fontSize: 19, fontWeight: "800" } }, String(s[1])),
          h(RN.Text, { numberOfLines: 1, style: { color: C.sub, fontSize: 12, marginTop: 2, fontWeight: "600" } }, s[0])))) : null);
  }
  function KitGuide(p) {
    const C = palette(), h = React.createElement;
    const [open, setOpen] = React.useState(true);
    const steps = p.steps || [];
    return h(RN.View, { style: { marginTop: 4, marginBottom: 16, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.card2, overflow: "hidden" } },
      h(RN.Pressable, { onPress: () => setOpen(!open), accessibilityRole: "button", accessibilityState: { expanded: open }, style: ({ pressed }) => ({ flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: pressed ? C.press : "transparent" }) },
        KitTile({ k: "guide", size: 34 }),
        h(RN.View, { style: { flex: 1 } },
          h(RN.Text, { style: { color: C.text, fontSize: 17, fontWeight: "800" } }, p.title || "Quick guide"),
          h(RN.Text, { style: { color: C.sub, fontSize: 13, marginTop: 2 } }, steps.length + " short steps")),
        h(RN.View, { style: { width: 24, alignItems: "center", justifyContent: "center" } }, KitChevron({ dir: open ? "up" : "down", color: C.sub, size: 9 }))),
      open ? h(RN.View, { style: { paddingHorizontal: 16, paddingBottom: 6 } }, ...steps.map((s, i) =>
        h(RN.View, { key: "guide-" + i, style: { flexDirection: "row", paddingTop: 12, paddingBottom: 14, borderTopWidth: 1, borderTopColor: C.card2 } },
          h(RN.View, { style: { width: 26, height: 26, borderRadius: 13, backgroundColor: hexA(C.blurple, 0.2), alignItems: "center", justifyContent: "center", marginRight: 13, marginTop: 1 } },
            h(RN.Text, { style: { color: C.blurple, fontSize: 13, fontWeight: "800" } }, String(i + 1))),
          h(RN.View, { style: { flex: 1 } },
            h(RN.Text, { style: { color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 3 } }, s[0]),
            h(RN.Text, { style: { color: C.sub, fontSize: 14, lineHeight: 20 } }, s[1]))))) : null);
  }
  function KitChip(p) {
    const C = palette(), h = React.createElement;
    return h(RN.Pressable, { onPress: p.onPress, accessibilityRole: "button", accessibilityState: { selected: !!p.active }, hitSlop: 4,
      style: ({ pressed }) => ({ height: 34, borderRadius: 17, paddingHorizontal: 14, marginRight: p.flush ? 0 : 8, marginBottom: p.flush ? 0 : 8, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: p.active ? C.blurple : C.chip, opacity: pressed ? 0.8 : 1 }) },
      h(RN.Text, { numberOfLines: 1, style: { color: p.active ? "#FFFFFF" : C.text, fontSize: 14, fontWeight: "600" } }, p.label),
      p.badge ? h(RN.View, { style: { marginLeft: 7, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: p.active ? "rgba(255,255,255,0.28)" : hexA(C.blurple, 0.22), alignItems: "center", justifyContent: "center" } },
        h(RN.Text, { style: { color: p.active ? "#FFFFFF" : C.blurple, fontSize: 12, fontWeight: "800" } }, String(p.badge))) : null);
  }

  /* ---- ping data ---- */
  function fmtTime(ms) {
    const d = new Date(ms);
    const p = (n) => (n < 10 ? "0" : "") + n;
    const t = p(d.getHours()) + ":" + p(d.getMinutes());
    if (d.toDateString() === new Date().toDateString()) return t;
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + t;
  }
  function nameOf(u) {
    if (!u) return "Unknown";
    return u.globalName || u.global_name || u.username || "Unknown";
  }
  function loadStores() {
    ReadStateStore = ReadStateStore || findByStoreName("ReadStateStore");
    MessageStore = MessageStore || findByStoreName("MessageStore");
    UserStore = UserStore || findByStoreName("UserStore");
    ChannelStore = ChannelStore || findByStoreName("ChannelStore");
    GuildStore = GuildStore || findByStoreName("GuildStore");
    return !!(ReadStateStore && UserStore && ChannelStore && FluxDispatcher);
  }
  const getChannel = (id) => { try { return id ? ChannelStore.getChannel(id) : null; } catch (_) { return null; } };
  const isDM = (ch) => !!ch && (ch.type === 1 || ch.type === 3);
  const myId = () => { try { return UserStore.getCurrentUser()?.id || null; } catch (_) { return null; } };
  const gte = (a, b) => { a = String(a); b = String(b); return a.length !== b.length ? a.length > b.length : a >= b; };
  const snowflakeTime = (id) => { const n = Number(id); return n > 0 ? Math.floor(n / 4194304) + 1420070400000 : 0; };

  function channelLabel(channelId, guildId) {
    const ch = getChannel(channelId);
    if (!ch) return "Unknown channel";
    if (isDM(ch)) {
      let name = ch.name;
      if (!name) {
        try { name = (ch.recipients || []).map((id) => UserStore.getUser(id)?.username).filter(Boolean).join(", "); } catch (_) {}
      }
      return "DM \u00B7 " + (name || "Unknown");
    }
    let guild = null;
    try { guild = GuildStore && GuildStore.getGuild(guildId || ch.guild_id)?.name; } catch (_) {}
    return "#" + (ch.name || "channel") + (guild ? " \u00B7 " + guild : "");
  }

  function cleanText(raw) {
    let s = String(raw == null ? "" : raw);
    s = s.replace(/<@!?(\d+)>/g, (m0, id) => { try { const u = UserStore.getUser(id); return "@" + (u ? nameOf(u) : "user"); } catch (_) { return "@user"; } });
    s = s.replace(/<@&(\d+)>/g, "@role");
    s = s.replace(/<#(\d+)>/g, (m0, id) => { const c = getChannel(id); return "#" + (c && c.name || "channel"); });
    s = s.replace(/<a?:(\w+):\d+>/g, ":$1:").replace(/\s+/g, " ").trim();
    return clip(s, SNIPPET);
  }

  function pingKind(m, ch, me) {
    if (!m || !m.author || m.author.id === me) return null;
    if (isDM(ch)) return "dm";
    const ref = m.referencedMessage && (m.referencedMessage.message || m.referencedMessage) || m.referenced_message;
    if (ref && ref.author && ref.author.id === me) return "reply";
    if (m.mentioned === true) return "mention";
    try {
      for (const u of m.mentions || []) if ((typeof u === "string" ? u : u && u.id) === me) return "mention";
    } catch (_) {}
    if (m.mention_everyone === true || m.mentionEveryone === true) return "mention";
    return null;
  }

  function entryFrom(m, kind) {
    const text = cleanText(m.content) || ((m.attachments && m.attachments.length) ? "(attachment)" : (m.embeds && m.embeds.length) ? "(embed)" : "");
    return { id: String(m.id), at: snowflakeTime(m.id), an: nameOf(m.author), t: text, k: kind };
  }

  function capture(e) {
    const m = e && e.message;
    if (!m || !m.id) return;
    const channelId = String(m.channel_id || m.channelId || e.channelId || "");
    const me = myId();
    if (!channelId || !me) return;
    const kind = pingKind(m, getChannel(channelId), me);
    if (!kind) return;
    const list = captured.get(channelId) || [];
    if (list.some((x) => x.id === String(m.id))) return;
    list.push(entryFrom(m, kind));
    if (list.length > PER_CHANNEL) list.splice(0, list.length - PER_CHANNEL);
    captured.delete(channelId);
    captured.set(channelId, list);
    while (captured.size > MAX_CHANNELS) captured.delete(captured.keys().next().value);
  }
  function ack(channelId, messageId) {
    if (!channelId) return;
    const key = String(channelId);
    const list = captured.get(key);
    if (!list) return;
    const kept = messageId ? list.filter((x) => !gte(messageId, x.id)) : [];
    if (kept.length) captured.set(key, kept); else captured.delete(key);
  }
  function drop(channelId, id) {
    if (!channelId || !id) return;
    const key = String(channelId);
    const list = captured.get(key);
    if (!list) return;
    const kept = list.filter((x) => x.id !== String(id));
    if (kept.length) captured.set(key, kept); else captured.delete(key);
  }
  function schedule() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      for (const fn of Array.from(listeners)) { try { fn(); } catch (_) {} }
    }, 80);
  }
  function hookDispatch(args) {
    const e = args && args[0];
    if (!e || e.loggerRemoval) return;
    try {
      if (e.type === "MESSAGE_CREATE") capture(e);
      else if (e.type === "MESSAGE_ACK" || e.type === "CHANNEL_ACK") ack(e.channelId || e.channel_id, e.messageId || e.message_id);
      else if (e.type === "MESSAGE_DELETE") drop(e.channelId, e.id);
      else if (e.type === "MESSAGE_DELETE_BULK") { for (const id of e.ids || []) drop(e.channelId, id); }
      else if (e.type !== "CHANNEL_SELECT" && e.type !== "CONNECTION_OPEN") return;
    } catch (_) {}
    schedule();
  }

  function loadedMention(channelId, oldest) {
    if (!oldest) return null;
    try {
      const ms = MessageStore && MessageStore.getMessages(channelId);
      const arr = ms && (typeof ms.toArray === "function" ? ms.toArray() : ms._array) || [];
      const me = myId();
      const ch = getChannel(channelId);
      for (const m of arr) {
        if (!m || !m.id || !gte(m.id, oldest)) continue;
        const kind = pingKind(m, ch, me);
        if (kind) return entryFrom(m, kind);
      }
    } catch (_) {}
    return null;
  }
  function pickMessage(channelId, oldest) {
    const list = captured.get(String(channelId)) || [];
    const fresh = oldest ? list.filter((x) => gte(x.id, oldest)) : list;
    if (fresh.length) return fresh[0];
    return loadedMention(channelId, oldest);
  }

  function getRows() {
    if (!ReadStateStore) return [];
    let ids = [];
    try { ids = ReadStateStore.getMentionChannelIds ? Array.from(ReadStateStore.getMentionChannelIds()) : Array.from(captured.keys()); } catch (_) { ids = Array.from(captured.keys()); }
    const rows = [];
    for (const channelId of ids) {
      let count = 0;
      try { count = ReadStateStore.getMentionCount(channelId) || 0; } catch (_) {}
      if (count <= 0) continue;
      const ch = getChannel(channelId);
      const dm = isDM(ch);
      if (dm && !cfg().includeDMs) continue;
      let oldest = null;
      try { oldest = ReadStateStore.getOldestUnreadMessageId ? ReadStateStore.getOldestUnreadMessageId(channelId) : null; } catch (_) {}
      const hit = pickMessage(channelId, oldest);
      const id = hit ? hit.id : oldest || null;
      rows.push({ c: String(channelId), g: ch && ch.guild_id || null, count, id, an: hit && hit.an || "", t: hit && hit.t || "", k: hit && hit.k || (dm ? "dm" : "mention"), dm, at: hit && hit.at || (id ? snowflakeTime(id) : 0) });
    }
    rows.sort((a, b) => (b.at || 0) - (a.at || 0));
    return rows.slice(0, MAX_ROWS);
  }
  const totalOf = (rows) => rows.reduce((n, r) => n + r.count, 0);

  /* ---- jump + sheet ---- */
  function sheetParts() {
    if (partsCache && partsCache.ActionSheet) return partsCache;
    let ActionSheet = null, Close = null;
    try { const a = findByProps("ActionSheet"); ActionSheet = a && a.ActionSheet || null; } catch (_) {}
    try { const c = findByProps("ActionSheetCloseButton"); Close = c && c.ActionSheetCloseButton || null; } catch (_) {}
    partsCache = { ActionSheet, Close };
    return partsCache;
  }
  function closeSheet() {
    try { const s = findByProps("openLazy", "hideActionSheet"); s && s.hideActionSheet && s.hideActionSheet(SHEET_KEY); } catch (_) {}
  }
  function jumpTo(channelId, messageId) {
    if (!channelId) return;
    closeSheet();
    setTimeout(() => {
      let navigate = null, jump = null;
      try { navigate = findByProps("transitionToChannel"); } catch (_) {}
      try { jump = findByProps("jumpToMessage"); } catch (_) {}
      try {
        if (!navigate || typeof navigate.transitionToChannel !== "function") throw Error();
        navigate.transitionToChannel(String(channelId), {});
      } catch (_) { toast("Could not open this chat"); return; }
      if (!messageId) return;
      setTimeout(() => {
        try {
          if (!jump || typeof jump.jumpToMessage !== "function") throw Error();
          jump.jumpToMessage({ channelId: String(channelId), messageId: String(messageId), flash: true, jumpType: "ANIMATED" });
        } catch (_) { toast("Could not jump to this message"); }
      }, 650);
    }, 220);
  }

  function rowSubtitle(r) {
    const what = r.dm ? (r.count === 1 ? "unread message" : "unread messages") : (r.count === 1 ? "unread ping" : "unread pings");
    const meta = r.count + " " + what + (r.at ? " \u00B7 " + fmtTime(r.at) : "");
    const lead = r.t ? (r.an ? r.an + ": " : "") + r.t : "";
    return lead ? lead + "\n" + meta : meta;
  }

  function PingSheet() {
    const C = palette(), h = React.createElement;
    const [, bump] = React.useState(0);
    React.useEffect(() => { const fn = () => bump((x) => x + 1); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
    const rows = getRows();
    const total = totalOf(rows);
    const parts = sheetParts();
    const subtitle = rows.length
      ? total + (total === 1 ? " unread ping" : " unread pings") + " in " + rows.length + (rows.length === 1 ? " chat" : " chats")
      : "You are all caught up";
    const list = rows.length
      ? h(RN.ScrollView, { style: { maxHeight: Math.round(RN.Dimensions.get("window").height * 0.6) }, showsVerticalScrollIndicator: false, nestedScrollEnabled: true },
        h(RN.View, { style: { backgroundColor: C.card2, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: C.divider } },
          ...rows.map((r, i) => h(CustomRow, {
            key: r.c, icon: r.dm ? "chat" : r.k === "reply" ? "reply" : "at", title: channelLabel(r.c, r.g), subtitle: rowSubtitle(r),
            last: i === rows.length - 1, onPress: () => jumpTo(r.c, r.id),
            trailing: KitChip({ label: "Jump to", active: true, flush: true, onPress: () => jumpTo(r.c, r.id) }),
          }))))
      : h(RN.Text, { style: { color: C.sub, fontSize: 14, lineHeight: 20, textAlign: "center", paddingVertical: 28 } }, "No unread pings right now.");
    const body = h(RN.View, { style: { paddingHorizontal: 16, paddingBottom: 24 } },
      h(RN.View, { style: { flexDirection: "row", alignItems: "center", paddingTop: 4, paddingBottom: 14 } },
        KitTile({ k: "at", size: 40 }),
        h(RN.View, { style: { flex: 1 } },
          h(RN.Text, { style: { color: C.text, fontSize: 20, fontWeight: "800" } }, "Pings"),
          h(RN.Text, { style: { color: C.sub, fontSize: 13, marginTop: 2 } }, subtitle)),
        parts.Close ? h(parts.Close, { onPress: closeSheet }) : null),
      list);
    return parts.ActionSheet ? h(parts.ActionSheet, null, body) : body;
  }

  function fallbackMenu() {
    const rows = getRows();
    if (!rows.length) { toast("No unread pings"); return; }
    try {
      const sheets = findByProps("showSimpleActionSheet");
      if (sheets && typeof sheets.showSimpleActionSheet === "function") {
        sheets.showSimpleActionSheet({ key: SHEET_KEY, header: { title: "Pings" }, options: rows.slice(0, 20).map((r) => ({ label: channelLabel(r.c, r.g) + " (" + r.count + ")", onPress: () => jumpTo(r.c, r.id) })) });
        return;
      }
    } catch (_) {}
    toast("Could not open the ping list");
  }
  function openPings() {
    try {
      const sheets = findByProps("openLazy", "hideActionSheet");
      if (sheets && typeof sheets.openLazy === "function" && sheetParts().ActionSheet) {
        sheets.openLazy(Promise.resolve({ default: PingSheet }), SHEET_KEY, {});
        return;
      }
    } catch (_) {}
    fallbackMenu();
  }
  function jumpToNewest() {
    const rows = getRows();
    if (!rows.length) { toast("No unread pings"); return; }
    jumpTo(rows[0].c, rows[0].id);
  }

  /* ---- profile bar button ---- */
  function pingIcon() {
    for (const name of ICON_CANDIDATES) { const id = kitAsset(name); if (id) return id; }
    return null;
  }
  function iconButton() {
    if (iconButtonCache) return iconButtonCache;
    try { const m = findByProps("IconButton"); iconButtonCache = m && m.IconButton || null; } catch (_) {}
    return iconButtonCache;
  }
  function PingButton(p) {
    const h = React.createElement;
    const [, bump] = React.useState(0);
    React.useEffect(() => { const fn = () => bump((x) => x + 1); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
    const rows = getRows();
    if (!rows.length && cfg().hideWhenEmpty) return null;
    const IconButton = iconButton();
    const asset = pingIcon();
    if (!IconButton || !asset) return null;
    const hasNp = !!p.hasNameplate;
    const total = totalOf(rows);
    const icon = h(RN.View, { style: { flexDirection: "row", alignItems: "center" } },
      h(RN.Image, { source: asset, style: { width: 16, height: 16, tintColor: hasNp ? "white" : undefined } }));
    return h(RN.View, null,
      h(IconButton, { size: "sm", variant: hasNp ? "secondary-overlay" : "tertiary", icon, onPress: openPings, onLongPress: jumpToNewest }),
      cfg().showBadge && total > 0 ? h(RN.View, { pointerEvents: "none", style: { position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: RED, alignItems: "center", justifyContent: "center" } },
        h(RN.Text, { style: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" } }, total > 99 ? "99+" : String(total))) : null);
  }
  function findYouBarButton() {
    const tries = [
      () => metro.findByTypeName && metro.findByTypeName("YouBarNotificationsButton"),
      () => metro.findByName && metro.findByName("YouBarNotificationsButton", false),
      () => metro.findByName && metro.findByName("YouBarNotificationsButton"),
    ];
    for (const t of tries) { try { const r = t(); if (r && r.type) return r; } catch (_) {} }
    return null;
  }
  function patchYouBar() {
    const Btn = findYouBarButton();
    if (!Btn) return false;
    unpatches.push(patcher.after("type", Btn, (args, res) => {
      try {
        const props = args && args[0] || {};
        return React.createElement(React.Fragment, null, res, React.createElement(PingButton, { hasNameplate: !!props.hasNameplate }));
      } catch (_) { return res; }
    }));
    return true;
  }

  /* ---- settings ---- */
  function Settings() {
    rainStore.useStore();
    const [, bump] = React.useState(0);
    const C = palette(), h = React.createElement;
    const s = cfg();
    const rows = getRows();
    const toggle = (key, title, subtitle, icon, last) => h(CustomRow, { key, title, subtitle, icon, last: !!last,
      trailing: h(CustomSwitch, { value: !!s[key], onChange: (v) => { setSetting(key, v); bump((x) => x + 1); schedule(); } }) });
    const guide = h(KitGuide, { key: "guide", title: "Quick guide", steps: [
      ["Where the button is", "When you have unread pings, a button appears in your profile bar next to the notifications bell. Tap it to open the list. Long-press it to jump straight to the newest ping."],
      ["Reading the list", "Each row is a chat with unread pings: a mention, a reply to you or a DM. You see the chat, who wrote, a short preview and the time. The red number on the button counts every unread ping."],
      ["Jump to", "Tap Jump to (or the row) to open the chat and scroll to the first unread ping. If the message arrived while the app was closed, the chat opens at its oldest unread message instead."],
      ["When pings disappear", "The list follows Discord's own unread counters, so a chat leaves the list as soon as you read it in Discord. Turn off Only show with pings if you want the button to stay visible all the time."],
    ] });
    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { padding: 16, paddingBottom: 42 } },
      h(KitHero, { key: "hero", icon: "at", title: "Jump to Ping", subtitle: "Unread pings in one tap", stats: [["Unread", totalOf(rows)], ["Chats", rows.length]] }),
      h(CustomSection, { key: "button", title: "Button" },
        toggle("hideWhenEmpty", "Only show with pings", "Hide the button when you have no unread pings.", "bell"),
        toggle("showBadge", "Show count badge", "Show the number of unread pings on the button.", "at", true)),
      h(CustomSection, { key: "list", title: "List" },
        toggle("includeDMs", "Include DMs", "List unread direct messages as pings.", "chat", true)),
      h(CustomSection, { key: "preview", title: "Preview" },
        h(CustomAction, { title: "Open ping list", secondary: true, onPress: openPings })),
      guide,
      h(RN.Text, { style: { color: C.sub, fontSize: 12, textAlign: "center", marginTop: 1, opacity: 0.7 } }, "Jump to Ping " + BUILD));
  }

  function initializeAfterHydration() {
    if (!loadRequested || initialized) return;
    initialized = true;
    const s = cfg();
    const defaults = { hideWhenEmpty: true, showBadge: true, includeDMs: true };
    const missing = {};
    for (const k of Object.keys(defaults)) if (s[k] === undefined) missing[k] = defaults[k];
    if (Object.keys(missing).length) rainStore.useStore.getState().updateSettings(missing);
    if (!loadStores()) { toast("Jump to Ping: required Discord modules not found"); return; }
    captured.clear();
    try { unpatches.push(patcher.before("dispatch", FluxDispatcher, hookDispatch)); } catch (_) {}
    if (!patchYouBar()) toast("Jump to Ping: could not find the profile bar");
    try { UserStore.emitChange && UserStore.emitChange(); } catch (_) {}
    schedule();
  }

  function onLoad() {
    loadRequested = true;
    const store = rainStore.useStore;
    const current = store.getState();
    if (current._hasHydrated) {
      initializeAfterHydration();
      return;
    }

    const checkHydration = (state) => {
      if (!loadRequested || !state._hasHydrated) return;
      if (hydrationUnsubscribe) hydrationUnsubscribe();
      hydrationUnsubscribe = null;
      initializeAfterHydration();
    };
    hydrationUnsubscribe = store.subscribe(checkHydration);
    // Recheck after subscribing so hydration cannot finish between the first
    // check and subscription registration.
    checkHydration(store.getState());
  }

  function onUnload() {
    loadRequested = false;
    if (hydrationUnsubscribe) { hydrationUnsubscribe(); hydrationUnsubscribe = null; }
    initialized = false;
    for (const u of unpatches.splice(0)) { try { u(); } catch (_) {} }
    if (notifyTimer) { clearTimeout(notifyTimer); notifyTimer = null; }
    closeSheet();
    listeners.clear();
    captured.clear();
    try { UserStore && UserStore.emitChange && UserStore.emitChange(); } catch (_) {}
  }

  return { onLoad, onUnload, settings: Settings };
})();

module.exports = {
  start() { implementation.onLoad(); },
  stop() { implementation.onUnload(); },
  settings: implementation.settings,
};
