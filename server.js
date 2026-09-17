"use strict";

/*
=========================================================
 A股实时选股平台 V2.0
 真实行情后端

 腾讯：主行情源
 新浪：备用行情源

 API：

 /api/health

 /api/market-status

 /api/quotes?codes=600519,000858,000001

=========================================================
*/

const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;


/* =====================================================
   CORS
===================================================== */

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};


/* =====================================================
   HTTP 请求
===================================================== */

function requestText(url, options = {}) {

    return new Promise((resolve, reject) => {

        const u = new URL(url);

        const lib =
            u.protocol === "https:"
                ? https
                : http;

        const req =
            lib.request(
                {
                    hostname: u.hostname,
                    port: u.port || undefined,
                    path:
                        u.pathname +
                        u.search,

                    method: "GET",

                    headers:
                        options.headers || {},

                    timeout:
                        options.timeout || 10000
                },

                res => {

                    let data = "";

                    res.on(
                        "data",
                        chunk => {
                            data +=
                                chunk.toString(
                                    "binary"
                                );
                        }
                    );


                    res.on(
                        "end",
                        () => {

                            if (
                                res.statusCode < 200 ||
                                res.statusCode >= 300
                            ) {

                                reject(
                                    new Error(
                                        "HTTP " +
                                        res.statusCode
                                    )
                                );

                                return;
                            }

                            resolve(data);

                        }
                    );

                }
            );


        req.on(
            "timeout",
            () => {

                req.destroy(
                    new Error(
                        "请求超时"
                    )
                );

            }
        );


        req.on(
            "error",
            reject
        );


        req.end();

    });

}


/* =====================================================
   股票代码转换
===================================================== */

function normalizeCode(code) {

    return String(code || "")
        .replace(/\D/g, "")
        .slice(-6);

}


function toTencentCode(code) {

    code =
        normalizeCode(code);


    if (!code) {
        return null;
    }


    /*
      上海：
      6xxxxx

      深圳：
      0xxxxx / 3xxxxx
    */

    if (
        code.startsWith("6")
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
      北交所：
      4xxxxx / 8xxxxx

      本项目排除。
    */

    return null;

}


function toSinaCode(code) {

    code =
        normalizeCode(code);


    if (!code) {
        return null;
    }


    if (
        code.startsWith("6")
    ) {

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
   有效代码
===================================================== */

function validCodes(codes) {

    return [
        ...new Set(

            codes
                .map(normalizeCode)

                .filter(code => {

                    if (
                        code.length !== 6
                    ) {

                        return false;

                    }


                    /*
                      排除北交所
                    */

                    if (
                        code.startsWith("4") ||
                        code.startsWith("8")
                    ) {

                        return false;

                    }


                    /*
                      只允许沪深代码
                    */

                    if (
                        !(
                            code.startsWith("6") ||
                            code.startsWith("0") ||
                            code.startsWith("3")
                        )
                    ) {

                        return false;

                    }


                    return true;

                })

        )
    ];

}


/* =====================================================
   ST / *ST
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
   腾讯行情解析
===================================================== */

function parseTencent(text) {

    const result = [];

    /*
      示例：

      v_sh600519="...";

      腾讯字段采用 ~ 分隔。
    */

    const regex =
        /v_([a-zA-Z0-9_]+)="([^"]*)"/g;


    let match;


    while (
        (match = regex.exec(text))
        !== null
    ) {

        const symbol =
            match[1];


        const fields =
            match[2].split("~");


        if (
            fields.length < 5
        ) {

            continue;

        }


        const code =
            fields[2] ||
            symbol.replace(
                /^sh|^sz/,
                ""
            );


        const name =
            fields[1] || "";


        const price =
            Number(fields[3]) || 0;


        const prevClose =
            Number(fields[4]) || 0;


        const open =
            Number(fields[5]) || 0;


        const change =
            Number(fields[31]) || 0;


        const changePercent =
            Number(fields[32]) || 0;


        const high =
            Number(fields[33]) || 0;


        const low =
            Number(fields[34]) || 0;


        const volume =
            Number(fields[36]) || 0;


        const amount =
            Number(fields[37]) || 0;


        const turnover =
            Number(fields[38]) || 0;


        const amplitude =
            Number(fields[43]) || 0;


        const floatMarketCap =
            Number(fields[44]) || 0;


        const totalMarketCap =
            Number(fields[45]) || 0;


        const time =
            fields[30] || "";


        result.push({

            code,

            name,

            market:
                symbol.startsWith("sh")
                    ? "沪市"
                    : symbol.startsWith("sz")
                        ? "深市"
                        : "其他",

            source:
                "tencent",

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

            time

        });

    }


    return result;

}


/* =====================================================
   腾讯行情
===================================================== */

async function getTencentQuotes(codes) {

    const symbols =
        codes
            .map(toTencentCode)
            .filter(Boolean);


    if (!symbols.length) {
        return [];
    }


    const url =
        "https://qt.gtimg.cn/q=" +
        symbols.join(",");


    const text =
        await requestText(
            url,
            {
                timeout: 10000,

                headers: {
                    "User-Agent":
                        "Mozilla/5.0"
                }
            }
        );


    return parseTencent(text);

}


/* =====================================================
   新浪行情解析
===================================================== */

function parseSina(text) {

    const result = [];


    /*
      新浪：

      hq_str_sh600519="名称,开盘,昨收,现价,...";
    */

    const regex =
        /hq_str_([a-zA-Z0-9_]+)="([^"]*)"/g;


    let match;


    while (
        (match = regex.exec(text))
        !== null
    ) {

        const symbol =
            match[1];


        const fields =
            match[2].split(",");


        if (
            fields.length < 4
        ) {

            continue;

        }


        const code =
            symbol.replace(
                /^sh|^sz/,
                ""
            );


        const name =
            fields[0] || "";


        const open =
            Number(fields[1]) || 0;


        const prevClose =
            Number(fields[2]) || 0;


        const price =
            Number(fields[3]) || 0;


        const high =
            Number(fields[4]) || 0;


        const low =
            Number(fields[5]) || 0;


        const volume =
            Number(fields[8]) || 0;


        const amount =
            Number(fields[9]) || 0;


        const change =
            price - prevClose;


        const changePercent =
            prevClose
                ? (
                    change /
                    prevClose *
                    100
                )
                : 0;


        const time =
            fields[30] &&
            fields[31]
                ? fields[30] +
                  " " +
                  fields[31]
                : "";


        result.push({

            code,

            name,

            market:
                symbol.startsWith("sh")
                    ? "沪市"
                    : symbol.startsWith("sz")
                        ? "深市"
                        : "其他",

            source:
                "sina",

            price,

            prevClose,

            open,

            high,

            low,

            change,

            changePercent,

            volume,

            amount,

            time

        });

    }


    return result;

}


/* =====================================================
   新浪行情
===================================================== */

async function getSinaQuotes(codes) {

    const symbols =
        codes
            .map(toSinaCode)
            .filter(Boolean);


    if (!symbols.length) {
        return [];
    }


    const url =
        "https://hq.sinajs.cn/list=" +
        symbols.join(",");


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
   合并行情
===================================================== */

function mergeQuotes(
    tencent,
    sina
) {

    const map =
        new Map();


    /*
      先放新浪
    */

    for (
        const q of sina
    ) {

        if (
            !isExcludedName(
                q.name
            )
        ) {

            map.set(
                q.code,
                q
            );

        }

    }


    /*
      腾讯覆盖新浪
      腾讯为主行情源
    */

    for (
        const q of tencent
    ) {

        if (
            !isExcludedName(
                q.name
            )
        ) {

            map.set(
                q.code,
                q
            );

        }

    }


    return [
        ...map.values()
    ];

}


/* =====================================================
   中国时间
===================================================== */

function chinaTime() {

    const now =
        new Date();


    return new Date(
        now.getTime() +
        8 * 60 * 60 * 1000
    );

}


/* =====================================================
   市场状态
===================================================== */

function getMarketStatus() {

    const cn =
        chinaTime();


    const day =
        cn.getUTCDay();


    const hour =
        cn.getUTCHours();


    const minute =
        cn.getUTCMinutes();


    const totalMinutes =
        hour * 60 +
        minute;


    /*
      周末
    */

    if (
        day === 0 ||
        day === 6
    ) {

        return {

            status: "休市",

            trading: false,

            session: "周末"

        };

    }


    /*
      上午
      09:30 - 11:30
    */

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


    /*
      午休
      11:30 - 13:00
    */

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


    /*
      下午
      13:00 - 15:00
    */

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
   JSON
===================================================== */

function sendJSON(
    res,
    data,
    status = 200
) {

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
   API：Health
===================================================== */

async function handleAPI(
    req,
    res
) {

    const url =
        new URL(
            req.url,
            `http://${req.headers.host}`
        );


    /*
      健康检查
    */

    if (
        url.pathname ===
        "/api/health"
    ) {

        return sendJSON(
            res,
            {

                success: true,

                version: "2.0",

                service:
                    "A-share realtime market API",

                time:
                    new Date()
                        .toISOString()

            }
        );

    }


    /*
      市场状态
    */

    if (
        url.pathname ===
        "/api/market-status"
    ) {

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
    */

    if (
        url.pathname ===
        "/api/quotes"
    ) {

        const raw =
            (
                url.searchParams
                    .get("codes")
                || ""
            )
            .split(",");


        const codes =
            validCodes(raw);


        if (
            !codes.length
        ) {

            return sendJSON(
                res,
                {

                    success: true,

                    source: "none",

                    requested: 0,

                    received: 0,

                    data: []

                }
            );

        }


        let tencent = [];

        let sina = [];


        let tencentError =
            null;


        let sinaError =
            null;


        /*
          腾讯
        */

        try {

            tencent =
                await getTencentQuotes(
                    codes
                );

        }
        catch (error) {

            console.error(
                "Tencent:",
                error.message
            );

            tencentError =
                error.message;

        }


        /*
          新浪
        */

        try {

            sina =
                await getSinaQuotes(
                    codes
                );

        }
        catch (error) {

            console.error(
                "Sina:",
                error.message
            );

            sinaError =
                error.message;

        }


        const data =
            mergeQuotes(
                tencent,
                sina
            );


        let source =
            "none";


        if (
            tencent.length
        ) {

            source =
                "tencent";

        }
        else if (
            sina.length
        ) {

            source =
                "sina";

        }


        return sendJSON(
            res,
            {

                success: true,

                version: "2.0",

                source,

                requested:
                    codes.length,

                received:
                    data.length,

                data,

                errors: {

                    tencent:
                        tencentError,

                    sina:
                        sinaError

                },

                serverTime:
                    new Date()
                        .toISOString()

            }
        );

    }


    /*
      404
    */

    return sendJSON(
        res,
        {

            success: false,

            error:
                "API不存在",

            path:
                url.pathname

        },

        404
    );

}


/* =====================================================
   Server
===================================================== */

const server =
    http.createServer(
        async (
            req,
            res
        ) => {

            /*
              CORS OPTIONS
            */

            if (
                req.method ===
                "OPTIONS"
            ) {

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

            }
            catch (error) {

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
            "真实行情后端启动成功"
        );

        console.log(
            "Port:",
            PORT
        );

        console.log(
            "================================="
        );

    }
);
