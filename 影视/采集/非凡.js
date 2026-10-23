// @name 非凡
// @author https://api.ffzyapi.com (MacCMS 采集站)
// @description 刮削：支持，弹幕：不支持，嗅探：不需要（分享页解析出直链 m3u8）
// @dependencies: omnibox_sdk
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/xiaohu1949/OmniBox-Spider/raw/refs/heads/main/影视/采集/非凡.js

/**
 * 非凡影视（MacCMS 采集站）
 *
 * 标准 MacCMS 五接口：home / category / search / detail / play
 *
 * 播放链路说明（重点）：
 * - 采集站 API 返回的 vod_play_url 里，每条集数指向的是「分享页」URL，形如
 *   https://vip.ffzy-plays.com/share/<hash>，并非可直播的媒体地址。
 * - play 阶段抓取该分享页，从其内联脚本 `const url = "/YYYYMMDD/xxxx/index.m3u8?sign=..."`
 *   提取相对路径，拼上分享页所在域名（vip.ffzy-plays.com）得到真实 m3u8 直链（已实测 200）。
 * - 因此本源不需要嗅探，play 一律返回 parse=0 的直链。
 */

const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
const SITE_API = "https://api.ffzyapi.com/api.php/provide/vod/";
// 分享页 / 真实 m3u8 所在播放域名
const PLAY_HOST = "https://vip.ffzy-plays.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
// ==================== 配置区域结束 ====================

/**
 * 发送 HTTP 请求到采集站
 */
async function requestAPI(params = {}) {
  if (!SITE_API) {
    throw new Error("请配置采集站 API 地址（SITE_API）");
  }

  const url = new URL(SITE_API);
  Object.keys(params).forEach((key) => {
    const v = params[key];
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.append(key, v);
    }
  });

  OmniBox.log("info", `请求非凡: ${url.toString()}`);

  try {
    const response = await OmniBox.request(url.toString(), {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Referer": "https://www.ffzy.tv/",
      },
    });

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode}`);
    }

    return JSON.parse(response.body);
  } catch (error) {
    OmniBox.log("error", `非凡请求失败: ${error.message}`);
    throw error;
  }
}

/**
 * 安全转换为整数
 */
function toInt(value) {
  if (typeof value === "number") return Math.floor(value);
  if (typeof value === "string") {
    const num = parseInt(value, 10);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * 格式化视频列表（首页 / 分类 / 搜索共用）
 */
function formatVideos(list) {
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;

      const vodId = String(item.vod_id || item.VodID || "");
      let vodPlayFrom = String(item.vod_play_from || item.VodPlayFrom || "");

      if (vodPlayFrom && vodId && vodPlayFrom.includes("$$$")) {
        const lines = vodPlayFrom.split("$$$");
        const processedLines = lines
          .map((line) => (line.trim() ? `${line.trim()}-${vodId}` : line.trim()))
          .filter((line) => line);
        vodPlayFrom = processedLines.join("$$$");
      } else if (vodPlayFrom && vodId) {
        vodPlayFrom = `${vodPlayFrom}-${vodId}`;
      }

      return {
        vod_id: vodId,
        vod_name: String(item.vod_name || item.VodName || ""),
        vod_pic: String(item.vod_pic || item.VodPic || ""),
        type_id: String(item.type_id || item.TypeID || ""),
        type_name: String(item.type_name || item.TypeName || ""),
        vod_year: String(item.vod_year || item.VodYear || ""),
        vod_remarks: String(item.vod_remarks || item.VodRemarks || ""),
        vod_time: String(item.vod_time || item.VodTime || ""),
        vod_play_from: vodPlayFrom,
        vod_play_url: String(item.vod_play_url || item.VodPlayURL || ""),
        vod_douban_score: String(item.vod_douban_score || item.VodDoubanScore || ""),
      };
    })
    .filter((item) => item !== null && item.vod_id);
}

/**
 * 将旧格式播放源转换为新格式（vod_play_sources）
 */
function convertToPlaySources(vodPlayFrom, vodPlayUrl, vodId) {
  const playSources = [];
  if (!vodPlayFrom || !vodPlayUrl) return playSources;

  const sourceNames = vodPlayFrom.split("$$$").map((n) => n.trim()).filter(Boolean);
  const sourceUrls = vodPlayUrl.split("$$$").map((u) => u.trim()).filter(Boolean);
  const maxLength = Math.max(sourceNames.length, sourceUrls.length);

  for (let i = 0; i < maxLength; i++) {
    const sourceName = sourceNames[i] || `线路${i + 1}`;
    const sourceUrl = sourceUrls[i] || "";

    let cleanSourceName = sourceName;
    if (vodId && sourceName.endsWith(`-${vodId}`)) {
      cleanSourceName = sourceName.substring(0, sourceName.length - `-${vodId}`.length);
    }

    const episodes = [];
    if (sourceUrl) {
      const episodeSegments = sourceUrl.split("#").map((s) => s.trim()).filter(Boolean);
      for (const segment of episodeSegments) {
        const parts = segment.split("$");
        if (parts.length >= 2) {
          const episodeName = parts[0].trim();
          const playId = parts.slice(1).join("$").trim();
          if (episodeName && playId) episodes.push({ name: episodeName, playId });
        } else if (parts.length === 1 && parts[0]) {
          episodes.push({ name: `第${episodes.length + 1}集`, playId: parts[0].trim() });
        }
      }
    }

    if (episodes.length > 0) {
      playSources.push({ name: cleanSourceName, episodes });
    }
  }

  return playSources;
}

/**
 * 格式化详情视频
 */
function formatDetailVideos(list) {
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;

      const content = String(item.vod_content || item.VodContent || "").trim();
      const vodId = String(item.vod_id || item.VodID || "");
      let vodPlayFrom = String(item.vod_play_from || item.VodPlayFrom || "");

      if (vodPlayFrom && vodId && vodPlayFrom.includes("$$$")) {
        const lines = vodPlayFrom.split("$$$");
        const processedLines = lines
          .map((line) => (line.trim() ? `${line.trim()}-${vodId}` : line.trim()))
          .filter((line) => line);
        vodPlayFrom = processedLines.join("$$$");
      } else if (vodPlayFrom && vodId) {
        vodPlayFrom = `${vodPlayFrom}-${vodId}`;
      }

      const vodPlayUrl = String(item.vod_play_url || item.VodPlayURL || "");
      const vodPlaySources = convertToPlaySources(vodPlayFrom, vodPlayUrl, vodId);

      return {
        vod_id: vodId,
        vod_name: String(item.vod_name || item.VodName || ""),
        vod_pic: String(item.vod_pic || item.VodPic || ""),
        type_name: String(item.type_name || item.TypeName || ""),
        vod_year: String(item.vod_year || item.VodYear || ""),
        vod_area: String(item.vod_area || item.VodArea || ""),
        vod_remarks: String(item.vod_remarks || item.VodRemarks || ""),
        vod_actor: String(item.vod_actor || item.VodActor || ""),
        vod_director: String(item.vod_director || item.VodDirector || ""),
        vod_content: content,
        vod_play_sources: vodPlaySources.length > 0 ? vodPlaySources : undefined,
        vod_douban_score: String(item.vod_douban_score || item.VodDoubanScore || ""),
      };
    })
    .filter((item) => item !== null && item.vod_id);
}

/**
 * 格式化分类数据
 */
function formatClasses(classes) {
  if (!Array.isArray(classes)) return [];
  const seen = new Set();
  const result = [];
  for (const cls of classes) {
    if (typeof cls !== "object" || cls === null) continue;
    const typeId = String(cls.type_id || cls.TypeID || "");
    const typePid = String(cls.type_pid || cls.TypePID || "");
    const typeName = String(cls.type_name || cls.TypeName || "").trim();
    if (!typeId || seen.has(typeId)) continue;
    seen.add(typeId);
    result.push({ type_id: typeId, type_pid: typePid, type_name: typeName });
  }
  return result;
}

/**
 * 从分享页 HTML 中提取真实 m3u8 直链
 * 分享页内联形如：const url = "/20250516/41354_xxx/index.m3u8?sign=..."
 * 相对路径以分享页域名（或固定播放域名）为基准拼接。
 * @returns {string|null}
 */
function extractM3u8(html, shareUrl) {
  if (!html) return null;
  let path = null;
  const m = html.match(/(?:const|var|let)\s+url\s*=\s*["']([^"']+)["']/i);
  if (m) path = m[1];
  if (!path) {
    const m2 = html.match(/["'](\/[^\s"']*\.m3u8[^\s"']*)["']/i);
    if (m2) path = m2[1];
  }
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  let origin = PLAY_HOST;
  try {
    origin = new URL(shareUrl).origin;
  } catch (e) {
    /* 用默认播放域名 */
  }
  return origin.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
}

// ==================== 标准接口 ====================

/**
 * 首页：最新列表 + 分类
 */
async function home(params) {
  try {
    const page = params.page || "1";
    let response = await requestAPI({ ac: "list", pg: page });

    if (!response.class || (Array.isArray(response.class) && response.class.length === 0)) {
      try {
        const classResponse = await requestAPI({ ac: "class" });
        if (classResponse.class) response.class = classResponse.class;
      } catch (e) {
        OmniBox.log("warn", `非凡获取分类失败: ${e.message}`);
      }
    }

    const classes = formatClasses(response.class || []);
    const videos = formatVideos(response.list || []);
    return { class: classes, list: videos };
  } catch (error) {
    OmniBox.log("error", `非凡首页失败: ${error.message}`);
    return { class: [], list: [] };
  }
}

/**
 * 分类列表
 */
async function category(params) {
  try {
    const categoryId = params.categoryId;
    const page = params.page || 1;
    if (!categoryId) throw new Error("分类ID不能为空");

    const response = await requestAPI({ ac: "videolist", t: categoryId, pg: String(page) });
    const videos = formatVideos(response.list || []);
    return {
      page: toInt(response.page),
      pagecount: toInt(response.pagecount),
      total: toInt(response.total),
      list: videos,
    };
  } catch (error) {
    OmniBox.log("error", `非凡分类失败: ${error.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

/**
 * 详情
 */
async function detail(params) {
  try {
    const videoId = params.videoId;
    if (!videoId) throw new Error("视频ID不能为空");

    const response = await requestAPI({ ac: "detail", ids: videoId });
    const videos = formatDetailVideos(response.list || []);
    return { list: videos };
  } catch (error) {
    OmniBox.log("error", `非凡详情失败: ${error.message}`);
    return { list: [] };
  }
}

/**
 * 搜索
 */
async function search(params) {
  try {
    const keyword = params.keyword || params.wd || "";
    const page = params.page || 1;
    if (!keyword) {
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }

    OmniBox.log("info", `非凡搜索: ${keyword}, page=${page}`);
    const response = await requestAPI({ ac: "videolist", wd: keyword, pg: String(page) });
    const videos = formatVideos(response.list || []);
    return {
      page: toInt(response.page),
      pagecount: toInt(response.pagecount),
      total: toInt(response.total),
      list: videos,
    };
  } catch (error) {
    OmniBox.log("error", `非凡搜索失败: ${error.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

/**
 * 播放：分享页 → 真实 m3u8 直链
 */
async function play(params) {
  try {
    const playId = params.playId;
    const flag = params.flag || "";
    if (!playId) {
      return { urls: [], flag, header: {} };
    }

    // 已经是直链 m3u8/mp4，直接返回
    if (/\.(m3u8|mp4)(\?|$)/i.test(playId)) {
      return { urls: [{ name: "播放", url: playId }], flag, header: {}, parse: 0 };
    }

    // 否则视为分享页，抓取并解析真实 m3u8
    OmniBox.log("info", `非凡解析分享页: ${playId}`);
    const resp = await OmniBox.request(playId, {
      method: "GET",
      headers: { "User-Agent": UA, "Referer": PLAY_HOST + "/" },
    });
    if (resp.statusCode !== 200) {
      throw new Error(`分享页 HTTP ${resp.statusCode}`);
    }
    const m3u8 = extractM3u8(resp.body, playId);
    if (!m3u8) {
      throw new Error("未从分享页解析出 m3u8");
    }
    OmniBox.log("info", `非凡解析结果: ${m3u8}`);
    return { urls: [{ name: "播放", url: m3u8 }], flag, header: {}, parse: 0 };
  } catch (error) {
    OmniBox.log("error", `非凡播放解析失败: ${error.message}`);
    return { urls: [], flag: params.flag || "", header: {} };
  }
}

// 导出接口
module.exports = {
  home,
  category,
  search,
  detail,
  play,
};

// 使用公共 runner 处理标准输入/输出
const runner = require("spider_runner");
runner.run(module.exports);
