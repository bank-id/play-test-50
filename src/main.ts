import puppeteer, { Page, Protocol } from "puppeteer";
import {
  Node as NodeBase,
  Game,
  Status,
  splitMove,
  formatXY,
  Flag,
} from "@chessalpha/core";
import { contenders } from "./contenders";

interface Node extends NodeBase {
  timestamp: number;
}

declare module "@chessalpha/core" {
  interface Player {
    uid: string;
    name: string;
  }
}

const lobbyUrl = "https://spela.test.schack.se/lag-decemberdraget";

async function a(user: number) {
  const browser = await puppeteer.launch({ headless });
  const page = await browser.newPage();
  await page.goto(lobbyUrl, { waitUntil: "networkidle2" });
  await page.waitForSelector("button#\\:r0\\::not([disabled])");
  await page.click("button#\\:r0\\:");
  await page.waitForNavigation({ waitUntil: "networkidle2" });
  await page.waitForSelector("input[name=email]");
  await page.type("input[name=email]", `360132:${user}`);
  await page.click("button[type=submit]");
  await page.waitForSelector("input[name=password]");
  await page.type("input[name=password]", "wickstrom1234");
  await page.click("button[type=submit]");
  await page.waitForNavigation({ waitUntil: "networkidle2" });

  console.log(page.url());
  // await page.waitForNavigation({ waitUntil: "networkidle2" });
  // console.log(page.url());

  await game(user, page);
  // const chip = await page.waitForSelector("div[role=button] .MuiChip-label");
  // console.log(await chip?.evaluate((node) => node.textContent));

  // cdp.on("Network.webSocketFrameSent", (frameSent) =>
  //   console.log({ frameSent })
  // );
  // await browser.close();
}

async function game(user: number, page: Page) {
  const cdp = await page.target().createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");

  let game: Game | undefined;
  let nodes: Node[] = [];
  let oldNodes: Node[] = [];
  let color: 0 | 1 | undefined;

  function handleFrame(
    frameReceived: Protocol.Network.WebSocketFrameReceivedEvent
  ) {
    const frame = parseFirebaseFrame(frameReceived.response.payloadData);

    if (frame.type === "games") {
      game = frame.data;
      color =
        game.white.uid === `memdb_${user}`
          ? 1
          : game.black.uid === `memdb_${user}`
          ? 0
          : undefined;
      console.log(frame);
      if (!oldNodes.length) {
        getFirebase("nodes", frame.gameId).then(
          (_oldNodes) => (oldNodes = _oldNodes as Node[])
        );
      }
    } else if (frame.type === "nodes") {
      nodes = Object.values(frame.data);
    }
  }
  cdp.on("Network.webSocketFrameReceived", handleFrame);
  // cdp.on("Network.webSocketFrameSent", console.log);

  while (true) {
    if ((game?.status || 0) >= Status.ABORTED) {
      game = undefined;
      oldNodes = [];
      nodes = [];
      await page.goto(lobbyUrl, { waitUntil: "networkidle2" });
      continue;
    }
    if (oldNodes.length && nodes.length % 2 === color) {
      if (oldNodes.length === nodes.length) {
        const resignButton = await page.waitForSelector(
          `[aria-label="Ge upp"] button`
        );
        await resignButton?.click();
        const submitButton = await page.waitForSelector(
          `button::-p-text(Ge upp)`
        );
        await submitButton?.click();
        await sleep();
        continue;
      }
      const { move, timestamp } = oldNodes[nodes.length];
      console.log(color, 1111, move);
      if (move) {
        console.log(
          color,
          2222,
          move,
          (timestamp - oldNodes[nodes.length - 1].timestamp) / 4
        );
        await sleep();
        // await new Promise((resolve) =>
        //   setTimeout(
        //     resolve,
        //     (timestamp - oldNodes[nodes.length - 1].timestamp) / 4
        //   )
        // );
        const [from, to, flag] = splitMove(move);
        console.log(color, 3333, from, to);
        const piece = await page.waitForSelector(`[data-square="${from}"]`);
        const boundingBox = await piece?.boundingBox();
        if (!piece || !boundingBox) {
          console.log("No piece found", from);
          return;
        }
        console.log(color, 4444);
        const fromXY = formatXY(from);
        const toXY = formatXY(to);
        const x = boundingBox.x + boundingBox.width / 2;
        const y = boundingBox.y + boundingBox.height / 2;
        console.log(color, 5555, fromXY, toXY);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(
          x +
            (color ? toXY.x - fromXY.x : fromXY.x - toXY.x) * boundingBox.width,
          y +
            (color ? toXY.y - fromXY.y : fromXY.y - toXY.y) * boundingBox.height
        );
        await page.mouse.up();

        if (flag && flag & Flag.Promotion) {
          const promotionPiece = await page.waitForSelector(
            `.css-1stjhfb svg:nth-of-type(${
              flag === Flag.PromoteQueen
                ? 1
                : flag === Flag.PromoteRook
                ? 2
                : flag === Flag.PromoteBishop
                ? 3
                : 4
            })`
          );
          await promotionPiece?.click();
        }

        console.log("---");
      }
    }
    console.log("waiting");
    await sleep();
  }

  cdp.off("Network.webSocketFrameReceived", handleFrame);
  // cdp.off("Network.webSocketFrameSent", console.log);

  // await page.waitForNavigation({ waitUntil: "networkidle2" });
  // const gameId = page.url().match(/memdb\_(\d+)\-\d+/)?.[1];
  // if (!gameId) {
  //   console.log("No game id found", page.url());
  //   return;
  // }
  // const nodes = await getNodes(gameId);
  // await page.waitForSelector("[data-flipped]");
}

async function getFirebase(type: "nodes" | "games", gameId: string | number) {
  const startGameNo = 366299;
  const endGameNo = 366538;
  const newGameId = `memdb_${
    (Number(gameId) % (endGameNo - startGameNo - 8)) + startGameNo
  }-0`;
  console.log({ newGameId });
  const firebaseUrl =
    "https://ssf-production-0-default-rtdb.europe-west1.firebasedatabase.app";
  const res = await fetch(
    `${firebaseUrl}/${type}/45-schackfyran-andra-chansen-2/${newGameId}.json`
  );
  const json = await res.json();
  return json;
}

function parseFirebaseFrame(frame: string) {
  const json = JSON.parse(frame) as
    | { d?: { b?: { d: unknown; p?: string } } }
    | undefined;

  if (!json?.d?.b) {
    return {};
  }

  const { d: data, p: path } = json.d.b;

  const match = path?.match(/(.*)\/(.*)\/(.*)/);
  if (match) {
    const type = match[1];
    const gameId = Number(match[3].match(/memdb\_(\d+)\-\d+/)?.[1]);
    if (type === "nodes") {
      return {
        data: data as Node[],
        path,
        type,
        gameId,
      } as const;
    }
    if (type === "games") {
      return {
        data: data as Game,
        path,
        type,
        gameId,
      } as const;
    }
  }

  return { data, path, type: undefined, gameId: undefined };
}

function sleep() {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

// 423038

// 1

// await Promise.allSettled([a(698535), a(669630), a(704831), a(693387)]);

// const headless = false;
const headless = (process.env.HEADLESS || false) as boolean | "new";
const start = parseInt(process.env.REPO_NAME?.match(/\d+/)?.[0] || "0");
const CONTENDER_INDEX = parseInt(process.env.CONTENDER_INDEX || "0");
const size = 10;
await Promise.allSettled(
  contenders
    .slice(start + CONTENDER_INDEX * size, start + (CONTENDER_INDEX + 1) * size)
    .map((contender) => a(contender))
);
