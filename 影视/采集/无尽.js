// @name 无尽
// @author https://api.wujinapi.me (MacCMS 采集站)
// @description 刮削：支持，弹幕：不支持，嗅探：不需要（直链 m3u8）
// @dependencies: omnibox_sdk
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/xiaohu1949/OmniBox-Spider/raw/refs/heads/main/影视/采集/无尽.js

/**
 * 无尽影视（MacCMS 采集站）
 *
 * 标准 MacCMS 五接口：home / category / search / detail / play
 *
 * 域名与接口说明（重点）：
 * - 列表 / 详情 / 分类 走 .me 域：https://api.wujinapi.me/api.php/provide/vod/
 * - 搜索走 .com 域：https://api.wujinapi.com/api.php/provide/vod/
 *   原因：.me 域的搜索接口被 Cloudflare 拦截（403 Just a moment），
 *   而 .com 域搜索正常（已在容器内 node 实测确认）。列表/详情在 .me 直出，
 *   故按接口分域请求，互不干扰。
 * - 播放地址在 API 里已是直链 m3u8（如 https://v11.ppqrrs.com/.../index.m3u8），
 *   无需分享页跳转、无需嗅探，play 直接返回 parse=0。
 * - 分类为平铺结构：共 63 个，type_id 1~5 是「电影/连续剧/综艺/动漫/资讯」等大类（内容为空），
 *   真正有内容的是 id 6 起的子类（动作片/喜剧片…）。分类列表原样返回，由用户选择子类浏览。
 */

const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
const LIST_HOST = "https://api.wujinapi.me"; // 列表 / 详情 / 分类
const SEARCH_HOST = "https://api.wujinapi.com"; // 搜索（.me 被 CF 拦截，改走 .com）
const API_PATH = "/api.php/provide/vod/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
// ==================== 配置区域结束 ====================

/**
 * 构建请求 URL
 */
function buildUrl(host, params = {}) {
  const url = new URL(host + API_PATH);
  Object.keys(params).forEach((key) => {
    const v = params[key];
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.append(key, v);
    }
  });
  return url.toString();
}

/**
 * 发送 HTTP 请求到指定域
 */
async function requestAPI(host, params = {}) {
  const url = buildUrl(host, params);
  OmniBox.log("info", `请求无尽: ${url}`);
  try {
    const response = await OmniBox.request(url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Referer": host + "/",
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode}`);
    }
    return JSON.parse(response.body);
  } catch (error) {
    OmniBox.log("error", `无尽请求失败: ${error.message}`);
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

// ==================== 标准接口 ====================

/**
 * 首页：最新列表 + 分类（列表/分类走 .me）
 */
async function home(params) {
  try {
    const page = params.page || "1";
    let response = await requestAPI(LIST_HOST, { ac: "list", pg: page });

    if (!response.class || (Array.isArray(response.class) && response.class.length === 0)) {
      try {
        const classResponse = await requestAPI(LIST_HOST, { ac: "class" });
        if (classResponse.class) response.class = classResponse.class;
      } catch (e) {
        OmniBox.log("warn", `无尽获取分类失败: ${e.message}`);
      }
    }

    const classes = formatClasses(response.class || []);
    const videos = formatVideos(response.list || []);
    return { class: classes, list: videos };
  } catch (error) {
    OmniBox.log("error", `无尽首页失败: ${error.message}`);
    return { class: [], list: [] };
  }
}

/**
 * 分类列表（.me）
 */
async function category(params) {
  try {
    const categoryId = params.categoryId;
    const page = params.page || 1;
    if (!categoryId) throw new Error("分类ID不能为空");

    const response = await requestAPI(LIST_HOST, { ac: "videolist", t: categoryId, pg: String(page) });
    const videos = formatVideos(response.list || []);
    return {
      page: toInt(response.page),
      pagecount: toInt(response.pagecount),
      total: toInt(response.total),
      list: videos,
    };
  } catch (error) {
    OmniBox.log("error", `无尽分类失败: ${error.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

/**
 * 详情（.me）
 */
async function detail(params) {
  try {
    const videoId = params.videoId;
    if (!videoId) throw new Error("视频ID不能为空");

    const response = await requestAPI(LIST_HOST, { ac: "detail", ids: videoId });
    const videos = formatDetailVideos(response.list || []);
    return { list: videos };
  } catch (error) {
    OmniBox.log("error", `无尽详情失败: ${error.message}`);
    return { list: [] };
  }
}

/**
 * 搜索（走 .com，避开 .me 的 Cloudflare 拦截）
 */
async function search(params) {
  try {
    const keyword = params.keyword || params.wd || "";
    const page = params.page || 1;
    if (!keyword) {
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }

    OmniBox.log("info", `无尽搜索: ${keyword}, page=${page}`);
    const response = await requestAPI(SEARCH_HOST, { ac: "videolist", wd: keyword, pg: String(page) });
    const videos = formatVideos(response.list || []);
    return {
      page: toInt(response.page),
      pagecount: toInt(response.pagecount),
      total: toInt(response.total),
      list: videos,
    };
  } catch (error) {
    OmniBox.log("error", `无尽搜索失败: ${error.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

/**
 * 播放：播放地址已是直链 m3u8，直接返回
 */
async function play(params) {
  try {
    const playId = params.playId;
    const flag = params.flag || "";
    if (!playId) {
      return { urls: [], flag, header: {} };
    }

    let parse = 1;
    if (/\.(m3u8|mp4)(\?|$)/i.test(playId)) {
      parse = 0;
    }

    return {
      urls: [{ name: "播放", url: playId }],
      flag,
      // 视频 CDN 通常需要带本站 Referer 才能拉流
      header: { "Referer": LIST_HOST + "/", "User-Agent": UA },
      parse,
    };
  } catch (error) {
    OmniBox.log("error", `无尽播放失败: ${error.message}`);
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
