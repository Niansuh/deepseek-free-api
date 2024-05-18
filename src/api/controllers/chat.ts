import { PassThrough } from "stream";
import _ from "lodash";
import AsyncLock from "async-lock";
import axios, { AxiosResponse } from "axios";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import { createParser } from "eventsource-parser";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";


const MODEL_NAME = "deepseek-chat";

const ACCESS_TOKEN_EXPIRES = 3600;

const MAX_RETRY_COUNT = 3;

const RETRY_DELAY = 5000;

const FAKE_HEADERS = {
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "zh-CN,zh;q=0.9",
  Origin: "https://chat.deepseek.com",
  Pragma: "no-cache",
  Referer: "https://chat.deepseek.com/",
  "Sec-Ch-Ua":
    '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "X-App-Version": "20240126.0",
};

const accessTokenMap = new Map();

const accessTokenRequestQueueMap: Record<string, Function[]> = {};


const chatLock = new AsyncLock();


async function requestToken(refreshToken: string) {
  if (accessTokenRequestQueueMap[refreshToken])
    return new Promise((resolve) =>
      accessTokenRequestQueueMap[refreshToken].push(resolve)
    );
  accessTokenRequestQueueMap[refreshToken] = [];
  logger.info(`Refresh token: ${refreshToken}`);
  const result = await (async () => {
    const result = await axios.get(
      "https://chat.deepseek.com/api/v0/users/current",
      {
        headers: {
          Authorization: `Bearer ${refreshToken}`,
          ...FAKE_HEADERS,
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    const { token } = checkResult(result, refreshToken);
    return {
      accessToken: token,
      refreshToken: token,
      refreshTime: util.unixTimestamp() + ACCESS_TOKEN_EXPIRES,
    };
  })()
    .then((result) => {
      if (accessTokenRequestQueueMap[refreshToken]) {
        accessTokenRequestQueueMap[refreshToken].forEach((resolve) =>
          resolve(result)
        );
        delete accessTokenRequestQueueMap[refreshToken];
      }
      logger.success(`Refresh successful`);
      return result;
    })
    .catch((err) => {
      if (accessTokenRequestQueueMap[refreshToken]) {
        accessTokenRequestQueueMap[refreshToken].forEach((resolve) =>
          resolve(err)
        );
        delete accessTokenRequestQueueMap[refreshToken];
      }
      return err;
    });
  if (_.isError(result)) throw result;
  return result;
}


async function acquireToken(refreshToken: string): Promise<string> {
  let result = accessTokenMap.get(refreshToken);
  if (!result) {
    result = await requestToken(refreshToken);
    accessTokenMap.set(refreshToken, result);
  }
  if (util.unixTimestamp() > result.refreshTime) {
    result = await requestToken(refreshToken);
    accessTokenMap.set(refreshToken, result);
  }
  return result.accessToken;
}


async function clearContext(model: string, refreshToken: string) {
  const token = await acquireToken(refreshToken);
  const result = await axios.post(
    "https://chat.deepseek.com/api/v0/chat/clear_context",
    {
      model_class: model,
      append_welcome_message: false
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        ...FAKE_HEADERS,
      },
      timeout: 15000,
      validateStatus: () => true,
    }
  );
  checkResult(result, refreshToken);
}


async function createCompletion(
  model = MODEL_NAME,
  messages: any[],
  refreshToken: string,
  retryCount = 0
) {
  return (async () => {
    logger.info(messages);


    const result = await chatLock.acquire(refreshToken, async () => {

      await clearContext(model, refreshToken);

      const token = await acquireToken(refreshToken);
      return await axios.post(
        "https://chat.deepseek.com/api/v0/chat/completions",
        {
          message: messagesPrepare(messages),
          stream: true,
          model_preference: null,
          model_class: model,
          temperature: 0
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...FAKE_HEADERS
          },

          timeout: 120000,
          validateStatus: () => true,
          responseType: "stream",
        }
      );
    });

    if (result.headers["content-type"].indexOf("text/event-stream") == -1) {
      result.data.on("data", buffer => logger.error(buffer.toString()));
      throw new APIException(
        EX.API_REQUEST_FAILED,
        `Stream response Content-Type invalid: ${result.headers["content-type"]}`
      );
    }

    const streamStartTime = util.timestamp();

    const answer = await receiveStream(model, result.data);
    logger.success(
      `Stream has completed transfer ${util.timestamp() - streamStartTime}ms`
    );

    return answer;
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Stream response error: ${err.stack}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCompletion(
          model,
          messages,
          refreshToken,
          retryCount + 1
        );
      })();
    }
    throw err;
  });
}


async function createCompletionStream(
  model = MODEL_NAME,
  messages: any[],
  refreshToken: string,
  retryCount = 0
) {
  return (async () => {
    logger.info(messages);

    const result = await chatLock.acquire(refreshToken, async () => {

      await clearContext(model, refreshToken);

      const token = await acquireToken(refreshToken);
      return await axios.post(
        "https://chat.deepseek.com/api/v0/chat/completions",
        {
          message: messagesPrepare(messages),
          stream: true,
          model_preference: null,
          model_class: model,
          temperature: 0
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...FAKE_HEADERS
          },

          timeout: 120000,
          validateStatus: () => true,
          responseType: "stream",
        }
      );
    });

    if (result.headers["content-type"].indexOf("text/event-stream") == -1) {
      logger.error(
        `Invalid response Content-Type:`,
        result.headers["content-type"]
      );
      result.data.on("data", buffer => logger.error(buffer.toString()));
      const transStream = new PassThrough();
      transStream.end(
        `data: ${JSON.stringify({
          id: "",
          model: MODEL_NAME,
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: "Service is temporarily unavailable, third-party response error",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          created: util.unixTimestamp(),
        })}\n\n`
      );
      return transStream;
    }
    const streamStartTime = util.timestamp();

    return createTransStream(model, result.data, () => {
      logger.success(
        `Stream has completed transfer ${util.timestamp() - streamStartTime}ms`
      );
    });
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Stream response error: ${err.stack}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCompletionStream(
          model,
          messages,
          refreshToken,
          retryCount + 1
        );
      })();
    }
    throw err;
  });
}


function messagesPrepare(messages: any[]) {
  let content;
  if (messages.length < 2) {
    content = messages.reduce((content, message) => {
      if (_.isArray(message.content)) {
        return (
          message.content.reduce((_content, v) => {
            if (!_.isObject(v) || v["type"] != "text") return _content;
            return _content + (v["text"] || "") + "\n";
          }, content)
        );
      }
      return content + `${message.content}\n`;
    }, "");
    logger.info("\nTransparent content:\n" + content);
  }
  else {
    content = (
      messages.reduce((content, message) => {
        if (_.isArray(message.content)) {
          return (
            message.content.reduce((_content, v) => {
              if (!_.isObject(v) || v["type"] != "text") return _content;
              return _content + (`${message.role}:` + v["text"] || "") + "\n";
            }, content)
          );
        }
        return (content += `${message.role}:${message.content}\n`);
      }, "") + "assistant:"
    )

      .replace(/\!\[.+\]\(.+\)/g, "");
    logger.info("\nConversation merge:\n" + content);
  }
  return content;
}


function checkResult(result: AxiosResponse, refreshToken: string) {
  if (!result.data) return null;
  const { code, data, msg } = result.data;
  if (!_.isFinite(code)) return result.data;
  if (code === 0) return data;
  if (code == 40003) accessTokenMap.delete(refreshToken);
  throw new APIException(EX.API_REQUEST_FAILED, `[Request deepseek failed]: ${msg}`);
}


async function receiveStream(model: string, stream: any): Promise<any> {
  return new Promise((resolve, reject) => {

    const data = {
      id: "",
      model,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      created: util.unixTimestamp(),
    };
    const parser = createParser((event) => {
      try {
        if (event.type !== "event") return;

        const result = _.attempt(() => JSON.parse(event.data));
        if (_.isError(result))
          throw new Error(`Stream response invalid: ${event.data}`);
        if (!result.choices || !result.choices[0] || !result.choices[0].delta || !result.choices[0].delta.content || result.choices[0].delta.content == ' ')
          return;
        data.choices[0].message.content += result.choices[0].delta.content;
        if (result.choices && result.choices[0] && result.choices[0].finish_reason === "stop")
          resolve(data);
      } catch (err) {
        logger.error(err);
        reject(err);
      }
    });

    stream.on("data", (buffer) => parser.feed(buffer.toString()));
    stream.once("error", (err) => reject(err));
    stream.once("close", () => resolve(data));
  });
}


function createTransStream(model: string, stream: any, endCallback?: Function) {

  const created = util.unixTimestamp();

  const transStream = new PassThrough();
  !transStream.closed &&
    transStream.write(
      `data: ${JSON.stringify({
        id: "",
        model,
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "" },
            finish_reason: null,
          },
        ],
        created,
      })}\n\n`
    );
  const parser = createParser((event) => {
    try {
      if (event.type !== "event") return;

      const result = _.attempt(() => JSON.parse(event.data));
      if (_.isError(result))
        throw new Error(`Stream response invalid: ${event.data}`);
      if (!result.choices || !result.choices[0] || !result.choices[0].delta || !result.choices[0].delta.content || result.choices[0].delta.content == ' ')
        return;
      result.model = model;
      transStream.write(`data: ${JSON.stringify({
        id: result.id,
        model: result.model,
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: result.choices[0].delta.content },
            finish_reason: null,
          },
        ],
        created,
      })}\n\n`);
      if (result.choices && result.choices[0] && result.choices[0].finish_reason === "stop") {
        transStream.write(`data: ${JSON.stringify({
          id: result.id,
          model: result.model,
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: "stop"
            },
          ],
          created,
        })}\n\n`);
        !transStream.closed && transStream.end("data: [DONE]\n\n");
      }
    } catch (err) {
      logger.error(err);
      !transStream.closed && transStream.end("data: [DONE]\n\n");
    }
  });

  stream.on("data", (buffer) => parser.feed(buffer.toString()));
  stream.once(
    "error",
    () => !transStream.closed && transStream.end("data: [DONE]\n\n")
  );
  stream.once(
    "close",
    () => !transStream.closed && transStream.end("data: [DONE]\n\n")
  );
  return transStream;
}


function tokenSplit(authorization: string) {
  return authorization.replace("Bearer ", "").split(",");
}


async function getTokenLiveStatus(refreshToken: string) {
  const token = await acquireToken(refreshToken);
  const result = await axios.get(
    "https://chat.deepseek.com/api/v0/users/current",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        ...FAKE_HEADERS,
      },
      timeout: 15000,
      validateStatus: () => true,
    }
  );
  try {
    const { token } = checkResult(result, refreshToken);
    return !!token;
  }
  catch (err) {
    return false;
  }
}

export default {
  createCompletion,
  createCompletionStream,
  getTokenLiveStatus,
  tokenSplit,
};
