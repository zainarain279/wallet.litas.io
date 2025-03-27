import fs from "fs/promises";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";
import readline from 'readline/promises';
import { TurnstileTask } from 'node-capmonster';
import { Solver } from "@2captcha/captcha-solver";
import bestcaptchasolver from 'bestcaptchasolver';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const sitekey = "0x4AAAAAAA5ufO6a8DkJVX0v";
console.log("1. 2Captcha - 2. Capmonster - 3. CapResolve (recommended as it's cheapest) - 4. Bestcaptchasolver");
const type = await rl.question("Enter your captcha solving service: ");
const apiKey = await rl.question("Enter your API key: ");

async function solveCaptcha(pageurl, type) {
  if (type === "1") {
    console.log("Solving captcha using 2Captcha");
    const solver = new Solver(apiKey);
    const result = (await solver.cloudflareTurnstile({ pageurl, sitekey })).data;
    console.log("Captcha solved successfully");
    return result;
  }
  if (type === "2") {
    console.log("Solving captcha using Capmonster");
    const capMonster = new TurnstileTask(apiKey);
    const task = capMonster.task({
        websiteKey: sitekey,
        websiteURL: pageurl
    });
    const taskId = await capMonster.createWithTask(task)
    const result = await capMonster.joinTaskResult(taskId)
    console.log("Captcha solved successfully");
    return result.token
  }
  if (type === "3") {
    const Solver = (await import("capsolver-npm")).Solver;
    const solver = new Solver({
      apiKey,
    });
    try {
      const token = await solver.turnstileproxyless({
        websiteURL: pageurl,
        websiteKey: sitekey,
      });
      console.log("Captcha solved successfully");
      return token.token
    } catch (error) {
      console.log("CapResolve Error: ", error.message);
    }
  }
  if (type === "4") {
    bestcaptchasolver.set_access_token(apiKey);
    try {
      const id = await bestcaptchasolver.submit_turnstile({
        page_url: pageurl,
        site_key: sitekey,
      })
      const token = await bestcaptchasolver.retrieve_captcha(id);
      console.log("Captcha solved successfully");
      return token.solution
    } catch (error) {
      console.log("Bestcaptchasolver Error: ", error.message);
    }
  }
}

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  Accept: "application/json",
};

async function getInfo(token, agent) {
  const headerInfo = {
    ...headers,
    authorization: `Bearer ${token.trim()}`,
    referer: "https://wallet.litas.io/miner",
  };
  const options = {
    method: "GET",
    headers: headerInfo,
    agent,
  };

  const response = await fetch(
    "https://wallet.litas.io/api/v1/users/current-user",
    options
  );
  const user = await response.json().catch(() => ({}));

  const response2 = await fetch(
    "https://wallet.litas.io/api/v1/users/current-user/balances",
    options
  );
  const balance = await response2.json().catch(() => ({}));

  return { user, balance };
}

async function login(body, agent, xtoken, cookie) {
  const headerInfo = {
    ...headers,
    "Accept-Encoding": "gzip, deflate, br",
    "X-CSRF-TOKEN": xtoken,
    Referer: "https://wallet.litas.io/login",
    "Accept-Encoding": "gzip, deflate, br",
    "Content-Type": "application/json",
    Cookie: cookie,
  };

  const options = {
    method: "POST",
    headers: headerInfo,
    agent,
    body: JSON.stringify({
      emailOrUserName: body.username,
      password: body.password,
      rememberMe: true,
      reCaptchaResponse: await solveCaptcha("https://wallet.litas.io/login", type),
    }),
  };

  const response = await fetch(
    "https://wallet.litas.io/api/v1/auth/login",
    options
  );
  const rs = await response.json().catch(() => ({}));
  
  if (rs.accessToken) {
    return { accessToken: rs.accessToken }
  }
  return { accessToken: null }
}

async function getXToken(token = '', agent) {
  const headerInfo = {
    ...headers,
    Referer: "https://wallet.litas.io/miner",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  };
  if (!token) {
    headerInfo.Authorization = "";
    headerInfo.Referer = "https://wallet.litas.io/login";
  } else {
    headerInfo.Authorization = `Bearer ${token.trim()}`
  }

  const options = {
    method: "GET",
    headers: headerInfo,
    agent,
    credentials: "include",
  };
  const response = await fetch(
    "https://wallet.litas.io/api/v1/antiforgery/token",
    options
  );
  const cookies = response.headers.get("Set-Cookie");
  const data = await response.json().catch(() => ({}));

  return { xtoken: data.token, cookie: cookies.split("; ")[0] };
}

async function minerClaim(token, xtoken, agent, refCode, cookie) {
  const headerInfo = {
    ...headers,
    authorization: `Bearer ${token.trim()}`,
    "Accept-Encoding": "gzip, deflate, br",
    "X-CSRF-TOKEN": xtoken,
    "IDEMPOTENCY-KEY": refCode,
    Referer: "https://wallet.litas.io/miner",
    Cookie: cookie,
  };
  const options = {
    method: "PATCH",
    headers: headerInfo,
    agent,
  };
  const response = await fetch(
    "https://wallet.litas.io/api/v1/miner/claim",
    options
  );
  const rs = await response.json().catch(() => ({}));
  if (response.status === 204) {
    return "✅ Claim successful";
  }
  return `❌ ${rs?.errors?.[0]?.message}` || "❌ Unknown error occurred";
}

async function readFiles() {
  const proxyStr = await fs.readFile("proxies.txt", "utf-8");
  const proxies = proxyStr.trim().split("\n");
  const accountStr = await fs.readFile("accounts.txt", "utf-8");
  const accounts = accountStr.trim().split("\n");
  return { proxies, accounts };
}

async function update(token, xtoken, agent, cookie, refCode) {
  const headerInfo = {
    ...headers,
    authorization: `Bearer ${token.trim()}`,
    "Accept-Encoding": "gzip, deflate, br",
    "X-CSRF-TOKEN": xtoken,
    "IDEMPOTENCY-KEY": refCode,
    Referer: "https://wallet.litas.io/miner",
    Cookie: cookie,
    Accept: "application/json"
  };
  console.log(headerInfo);
  
  const options = {
    method: "PATCH",
    headers: headerInfo,
    agent,
  };
  const response = await fetch(
    "https://wallet.litas.io/api/v1/miner/upgrade/speed",
    options
  );  
  const rs = await response.json().catch(() => ({}));
  if (response.status === 204) {
    return "✅ Update successful";
  }
  return `❌ ${rs?.errors?.[0]?.message}` || "❌ Unknown error occurred";
}

(function () {
    const colors = {
        reset: "\x1b[0m",
        bright: "\x1b[1m",
        dim: "\x1b[2m",
        underscore: "\x1b[4m",
        blink: "\x1b[5m",
        reverse: "\x1b[7m",
        hidden: "\x1b[8m",
        black: "\x1b[30m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
        bgBlack: "\x1b[40m",
        bgRed: "\x1b[41m",
        bgGreen: "\x1b[42m",
        bgYellow: "\x1b[43m",
        bgBlue: "\x1b[44m",
        bgMagenta: "\x1b[45m",
        bgCyan: "\x1b[46m",
        bgWhite: "\x1b[47m"
    };

const bannerLines = [
    `${colors.bright}${colors.green}░▀▀█░█▀█░▀█▀░█▀█${colors.reset}\n` +
    `${colors.bright}${colors.cyan}░▄▀░░█▀█░░█░░█░█${colors.reset}\n` +
    `${colors.bright}${colors.yellow}░▀▀▀░▀░▀░▀▀▀░▀░▀${colors.reset}`,
        `${colors.bright}${colors.bgBlue}╔══════════════════════════════════╗${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║                                  ║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.magenta}ZAIN ARAIN                      ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.cyan}AUTO SCRIPT MASTER              ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║                                  ║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.yellow}JOIN TELEGRAM CHANNEL NOW!      ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.green}https://t.me/AirdropScript6     ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.red}@AirdropScript6 - OFFICIAL      ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.cyan}CHANNEL                         ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║                                  ║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.green}FAST - RELIABLE - SECURE        ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║  ${colors.yellow}SCRIPTS EXPERT                  ${colors.bgBlue}║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}║                                  ║${colors.reset}`,
        `${colors.bright}${colors.bgBlue}╚══════════════════════════════════╝${colors.reset}`
    ];

    // Print each line separately
    bannerLines.forEach(line => console.log(line));
})();

async function main() {
  while (true) {
    const { proxies, accounts } = await readFiles();
    console.log("Litas Bot");
    console.log(
      "https://t.me/AirdropScript6"
    );
    console.log("------------------------------------------------------------");

    for (let i = 0; i < accounts.length; i++) {
      console.log("In progress with account", i + 1);
      const proxy = proxies[i].trim();
      const agent = new HttpsProxyAgent(proxy);

      console.log("ℹ️ Getting token is:");
      const xtokenLogin = await getXToken('', agent);
      const body = {
        username: accounts[i].split(",")[0].trim(),
        password: accounts[i].split(",")[1].trim(),
      };
      const { accessToken } = await login(body, agent, xtokenLogin.xtoken, xtokenLogin.cookie);
      if (!accessToken) {
        console.log("Error cannot log in");
        continue;
      }
      const { user, balance } = await getInfo(accessToken, agent);
      console.log("ℹ️ username To be:", user.nickName);
      console.log("ℹ️ balance:", balance);

      const { xtoken, cookie } = await getXToken(accessToken, agent, user.nickName);

      const claim = await minerClaim(
        accessToken,
        xtoken,
        agent,
        user.nickName,
        cookie
      );
      console.log(claim);
      if (claim == '❌ Not enough balance to perform this action.') {
        const xupdate = await getXToken(accessToken, agent, user.nickName);
        await update(accessToken, xupdate.xtoken, agent, xupdate.cookie, user.nickName);
        const claimAgain = await minerClaim(
          accessToken,
          xtoken,
          agent,
          user.nickName,
          cookie
        );
        console.log(claimAgain);
      }
      console.log("♾️  Account completed ", i + 1);
      console.log("-------------------------------------------------");
    }
    console.log("♾️  Chờ 3 tiếng để tiếp tục");
    await new Promise((resolve) => setTimeout(resolve, (3 * 60 * 60 * 1000) + 20 * 1000));
  }
}

main();
