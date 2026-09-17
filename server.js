/*
=========================================================
 A股实时选股平台 V2.0
 后端真实行情服务
 --------------------------------------------------------
 数据源：
 1. 腾讯财经：主行情源
 2. 新浪财经：备用行情源

 作用：
 - 解决 GitHub Pages 浏览器跨域问题
 - 获取沪深 A 股实时行情
 - 标准化行情字段
 - 提供给前端统一 JSON API
 - 为后续 MA / 成交量 / 买卖信号预留接口

 Node.js >= 18
=========================================================
*/

"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

/* =====================================================
   HTTP 请求工具
===================================================== */

function requestText(url, options = {}) {
    return new Promise((resolve, reject) => {

        const u = new URL(url);

        const lib = u.protocol === "https:" ? https : http;

        const req = lib.request(
            {
                hostname: u.hostname,
                port: u.port || undefined,
                path: u.pathname + u.search,
                method: "GET",
                headers: options.headers || {},
                timeout: options.timeout || 10000
            },
            res => {

                let data = "";

                res.on("data", chunk => {
                    data += chunk.toString("binary");
                });

                res.on("end", () => {

                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        reject(
                            new Error(
                                `HTTP ${res.statusCode}: ${url}`
                            )
                        );
                        return;
                    }

                    resolve(data);
                });
            }
        );

        req.on("timeout", () => {
            req.destroy(new Error("请求超时"));
        });

        req.on("error", reject);

        req.end();
    });
}


/* =====================================================
   腾讯行情
===================================================== */

function parseTencent(text, requestedCode) {

    /*
      腾讯格式：

      v_sh600519="贵州茅台~600519~...";

      字段：
      0  名称
      2  股票代码
      3  当前价格
      4  昨收
      5  今开
      30 时间
      31 涨跌
      32 涨跌幅
      33 最高
      34 最低
      36 成交量
      37 成交额
      38 换手率
      43 振幅
      44 流通市值
      45 总市值
    */

    const result = [];

    const regex =
        /v_([a-zA-Z0-9_]+)="([^"]*)"/g;

    let match;

    while ((match = regex.exec(text)) !== null) {

        const symbol = match[1];
        const fields = match[2].split("~");

        if (!fields.length) continue;

        const code =
            fields[2] ||
            requestedCode ||
            symbol.replace(/^sh|^sz/, "");

        const name = fields[1] || "";

        const price = Number(fields[3]) || 0;
        const prevClose = Number(fields[4]) || 0;
        const open = Number(fields[5]) || 0;

        const change = Number(fields[31]) || 0;
        const changePercent = Number(fields[32]) || 0;

        const high = Number(fields[33]) || 0;
        const low = Number(fields[34]) || 0;

        const volume = Number(fields[36]) || 0;
        const amount = Number(fields[37]) || 0;

        const turnover = Number(fields[38]) || 0;
        const amplitude = Number(fields[43]) || 0;

        const floatMarketCap =
            Number(fields[44]) || 0;

        const totalMarketCap =
            Number(fields[45]) || 0;

        const time = fields[30] || "";

        result.push({
            code,
            name,
            market:
                symbol.startsWith("sh")
                    ? "沪市"
                    : symbol.startsWith("sz")
                        ? "深市"
                        : "其他",

            source: "tencent",

            price,
            prevClose,
            open,
            high,
            low,

            change,
            changePercent,

            volume,
            amount,

            turnover,
            amplitude,

            floatMarketCap,
            totalMarketCap,

            time,

            raw: fields
        });
    }

    return result;
}


async function getTencentQuotes(codes) {

    if (!codes.length) return [];

    const symbols = codes.map(toTencentCode);

    /*
      腾讯支持一次查询多个股票。
    */

    const url =
        "https://qt.gtimg.cn/q=" +
        symbols.join(",");

    const text =
        await requestText(
            url,
            {
                timeout: 10000
            }
        );

    return parseTencent(text);
}


/* =====================================================
   新浪行情
===================================================== */

function parseSina(text) {

    const result = [];

    /*
      新浪格式：

      var hq_str_sh600519=
      "贵州茅台,开盘,昨收,现价,...";

      关键字段：

      0 名称
      1 开盘
      2 昨收
      3 现价
      4 最高
      5 最低
      8 成交量
      9 成交额
      30 日期
      31 时间
    */

    const regex =
        /hq_str_([a-zA-Z0-9_]+)="([^"]*)"/g;

    let match;

    while ((match = regex.exec(text)) !== null) {

        const symbol = match[1];
        const fields = match[2].split(",");

        if (fields.length < 4) continue;

        const code =
            symbol.replace(/^sh|^sz/, "");

        const market =
            symbol.startsWith("sh")
                ? "沪市"
                : symbol.startsWith("sz")
                    ? "深市"
                    : "其他";

        result.push({
            code,

            name: fields[0] || "",

            market,

            source: "sina",

            price: Number(fields[3]) || 0,

            prevClose: Number(fields[2]) || 0,

            open: Number(fields[1]) || 0,

            high: Number(fields[4]) || 0,

            low: Number(fields[5]) || 0,

            change:
                (Number(fields[3]) || 0) -
                (Number(fields[2]) || 0),

            changePercent:
                Number(fields[2])
                    ? (
                        (
                            Number(fields[3]) -
                            Number(fields[2])
                        )
                        /
                        Number(fields[2])
                        *
                        100
                    )
                    : 0,

            volume: Number(fields[8]) || 0,

            amount: Number(fields[9]) || 0,

            time:
                fields[30] && fields[31]
                    ? fields[30] + " " + fields[31]
                    : "",

            raw: fields
        });
    }

    return result;
}


async function getSinaQuotes(codes) {

    if (!codes.length) return [];

    const symbols =
        codes
            .map(toSinaCode)
            .join(",");

    const url =
        "https://hq.sinajs.cn/list=" +
        symbols;

    /*
      新浪目前部分环境要求 Referer。
    */

    const text =
        await requestText(
            url,
            {
                timeout: 10000,

                headers: {
                    "Referer":
                        "https://finance.sina.com.cn/",
                    "User-Agent":
                        "Mozilla/5.0"
                }
            }
        );

    return parseSina(text);
}


/* =====================================================
   股票代码转换
===================================================== */

function toTencentCode(code) {

    code = String(code).padStart(6, "0");

    if (
        code.startsWith("6") ||
        code.startsWith("68")
    ) {
        return "sh" + code;
    }

    if (
        code.startsWith("0") ||
        code.startsWith("3")
    ) {
        return "sz" + code;
    }

    /*
      本项目明确排除北交所。
    */

    return null;
}


function toSinaCode(code) {

    code = String(code).padStart(6, "0");

    if (code.startsWith("6")) {
        return "sh" + code;
    }

    if (
        code.startsWith("0") ||
        code.startsWith("3")
    ) {
        return "sz" + code;
    }

    return null;
}


/* =====================================================
   过滤无效代码
===================================================== */

function validCodes(codes) {

    return [
        ...new Set(
            codes
                .map(x =>
                    String(x)
                        .replace(/\D/g, "")
                        .slice(-6)
                )
                .filter(x => {

                    if (x.length !== 6) {
                        return false;
                    }

                    /*
                      北交所代码：

                      8xxxxx
                      4xxxxx

                      本项目全部排除。
                    */

                    if (
                        x.startsWith("8") ||
                        x.startsWith("4")
                    ) {
                        return false;
                    }

                    return true;
                })
        )
    ];
}


/* =====================================================
   ST / *ST 过滤
===================================================== */

function isExcludedName(name) {

    const n =
        String(name || "")
            .replace(/\s/g, "")
            .toUpperCase();

    return (
        n.startsWith("ST") ||
        n.startsWith("*ST")
    );
}


/* =====================================================
   行情合并
===================================================== */

function mergeQuotes(primary, backup) {

    const map = new Map();

    for (const q of backup) {
        map.set(q.code, q);
    }

    /*
      腾讯优先。
      腾讯缺失时使用新浪。
    */

    for (const q of primary) {
        map.set(q.code, q);
    }

    return [...map.values()]
        .filter(q => !isExcludedName(q.name));
}


/* =====================================================
   市场状态
===================================================== */

function getMarketStatus() {

    const now = new Date();

    /*
      服务端可能运行在 UTC。
      中国时间 = UTC + 8
    */

    const cn =
        new Date(
            now.getTime() +
            8 * 60 * 60 * 1000
        );

    const day = cn.getUTCDay();

    const hour = cn.getUTCHours();
    const minute = cn.getUTCMinutes();

    const totalMinutes =
        hour * 60 + minute;

    if (day === 0 || day === 6) {

        return {
            status: "休市",
            trading: false,
            session: "周末"
        };
    }

    if (
        totalMinutes >= 570 &&
        totalMinutes < 690
    ) {

        return {
            status: "交易中",
            trading: true,
            session: "上午交易"
        };
    }

    if (
        totalMinutes >= 690 &&
        totalMinutes < 780
    ) {

        return {
            status: "午间休市",
            trading: false,
            session: "午间休市"
        };
    }

    if (
        totalMinutes >= 780 &&
        totalMinutes <= 900
    ) {

        return {
            status: "交易中",
            trading: true,
            session: "下午交易"
        };
    }

    return {
        status: "休市",
        trading: false,
        session: "盘后"
    };
}


/* =====================================================
   JSON 响应
===================================================== */

function sendJSON(res, data, status = 200) {

    res.writeHead(
        status,
        {
            ...CORS_HEADERS,
            "Content-Type":
                "application/json; charset=utf-8"
        }
    );

    res.end(
        JSON.stringify(data)
    );
}


/* =====================================================
   API
===================================================== */

async function handleAPI(req, res) {

    const url =
        new URL(
            req.url,
            `http://${req.headers.host}`
        );

    /*
      健康检查
    */

    if (url.pathname === "/api/health") {

        return sendJSON(
            res,
            {
                success: true,
                version: "2.0",
                time: new Date().toISOString()
            }
        );
    }


    /*
      市场状态
    */

    if (url.pathname === "/api/market-status") {

        return sendJSON(
            res,
            {
                success: true,
                ...getMarketStatus()
            }
        );
    }


    /*
      实时行情

      /api/quotes?codes=600519,000858,000001
    */

    if (url.pathname === "/api/quotes") {

        const rawCodes =
            (
                url.searchParams.get("codes")
                || ""
            )
            .split(",");

        const codes =
            validCodes(rawCodes);

        if (!codes.length) {

            return sendJSON(
                res,
                {
                    success: true,
                    source: "none",
                    data: []
                }
            );
        }

        let tencent = [];
        let sina = [];

        let tencentError = null;
        let sinaError = null;

        /*
          腾讯
        */

        try {

            tencent =
                await getTencentQuotes(codes);

        } catch (e) {

            tencentError =
                e.message;
        }


        /*
          新浪备用
        */

        try {

            sina =
                await getSinaQuotes(codes);

        } catch (e) {

            sinaError =
                e.message;
        }


        const quotes =
            mergeQuotes(
                tencent,
                sina
            );


        /*
          最终统一数据
        */

        return sendJSON(
            res,
            {
                success: true,

                version: "2.0",

                source:
                    tencent.length
                        ? "tencent"
                        : sina.length
                            ? "sina"
                            : "none",

                requested:
                    codes.length,

                received:
                    quotes.length,

                data: quotes,

                errors: {
                    tencent:
                        tencentError,
                    sina:
                        sinaError
                },

                serverTime:
                    new Date().toISOString()
            }
        );
    }


    /*
      未知接口
    */

    return sendJSON(
        res,
        {
            success: false,
            error: "API不存在"
        },
        404
    );
}


/* =====================================================
   Server
===================================================== */

const server =
    http.createServer(
        async (req, res) => {

            if (req.method === "OPTIONS") {

                res.writeHead(
                    204,
                    CORS_HEADERS
                );

                res.end();

                return;
            }

            try {

                await handleAPI(
                    req,
                    res
                );

            } catch (error) {

                console.error(
                    error
                );

                sendJSON(
                    res,
                    {
                        success: false,
                        error:
                            error.message
                    },
                    500
                );
            }
        }
    );


server.listen(
    PORT,
    () => {

        console.log(
            "================================="
        );

        console.log(
            "A股实时选股平台 V2.0"
        );

        console.log(
            "Real Market Data Server"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "================================="
        );
    }
);
