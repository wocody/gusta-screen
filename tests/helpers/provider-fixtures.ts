interface BaseFixtureOptions {
  consent?: boolean;
  gate?: boolean;
  fullscreenWorks?: boolean;
  fullscreenHotkeyWorks?: boolean;
  startsPaused?: boolean;
  autoplayStartMs?: number;
  hangingPlayMs?: number;
}

interface AdOptions {
  type?: "none" | "finite" | "persistent";
  durationMs?: number;
}

interface TwitchFixtureOptions extends BaseFixtureOptions {
  ad?: AdOptions;
  unsupportedMessage?: string;
}

function serializeScenario(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function createTwitchFixtureHtml(
  options: TwitchFixtureOptions = {}
): string {
  const scenario = serializeScenario({
    consent: options.consent ?? false,
    gate: options.gate ?? false,
    fullscreenWorks: options.fullscreenWorks ?? true,
    fullscreenHotkeyWorks: options.fullscreenHotkeyWorks ?? false,
    startsPaused: options.startsPaused ?? true,
    autoplayStartMs: options.autoplayStartMs ?? null,
    hangingPlayMs: options.hangingPlayMs ?? 0,
    ad: {
      type: options.ad?.type ?? "none",
      durationMs: options.ad?.durationMs ?? 900
    },
    unsupportedMessage: options.unsupportedMessage ?? null
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Twitch Fixture</title>
    <style>
      body {
        margin: 0;
        font-family: Arial, sans-serif;
        background: linear-gradient(135deg, #14142a 0%, #34245f 100%);
        color: white;
      }
      #consent-banner,
      #gate-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(4, 4, 8, 0.8);
        z-index: 20;
      }
      #twitch-player {
        position: relative;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
      }
      video {
        width: 100%;
        height: 100%;
      }
      .fixture-label {
        position: absolute;
        left: 32px;
        top: 32px;
        font-size: 48px;
        font-weight: bold;
      }
      [data-a-target="player-overlay-play-button"],
      [data-a-target="player-play-pause-button"],
      [data-a-target="player-fullscreen-button"] {
        position: absolute;
        border: 0;
        background: rgba(14, 14, 22, 0.8);
        color: white;
        padding: 12px 18px;
        cursor: pointer;
      }
      [data-a-target="player-overlay-play-button"] {
        left: 32px;
        bottom: 32px;
      }
      [data-a-target="player-play-pause-button"] {
        left: 180px;
        bottom: 32px;
      }
      [data-a-target="player-fullscreen-button"] {
        right: 32px;
        bottom: 32px;
      }
      [data-test-selector="ad-banner-default-text"] {
        position: absolute;
        right: 32px;
        top: 32px;
        background: rgba(0, 0, 0, 0.7);
        padding: 12px 16px;
      }
      [hidden] {
        display: none !important;
      }
    </style>
  </head>
  <body>
    <div id="consent-banner" ${options.consent ? "" : "hidden"}>
      <button id="consent-accept">Accept</button>
    </div>
    <div id="gate-overlay" ${options.gate ? "" : "hidden"}>
      <button data-a-target="content-classification-gate-overlay-start-watching-button">Start Watching</button>
    </div>
    <div id="twitch-player">
      <video muted playsinline></video>
      <div class="fixture-label">Fixture Twitch</div>
      <button data-a-target="player-overlay-play-button">Play</button>
      <button data-a-target="player-play-pause-button">Toggle Play</button>
      <button data-a-target="player-fullscreen-button">Fullscreen</button>
      <div data-test-selector="ad-banner-default-text" hidden>Commercial Break</div>
    </div>
    <script>
      const scenario = ${scenario};
      const player = document.getElementById("twitch-player");
      const video = document.querySelector("video");
      const adBanner = document.querySelector('[data-test-selector="ad-banner-default-text"]');
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext("2d");
      let frame = 0;

      function drawFrame() {
        context.fillStyle = "#24184a";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#9147ff";
        context.fillRect(80, 80, 420, 180);
        context.fillStyle = "#ffffff";
        context.font = "bold 48px Arial";
        context.fillText("Twitch Fixture", 100, 170);
        context.font = "32px Arial";
        context.fillText("Frame " + frame, 100, 230);
        frame += 1;
      }

      drawFrame();
      window.setInterval(drawFrame, 100);
      video.srcObject = canvas.captureStream(30);

      const nativePlay = video.play.bind(video);
      video.play = () => {
        if (!scenario.hangingPlayMs) {
          return nativePlay();
        }

        return new Promise((resolve, reject) => {
          window.setTimeout(() => {
            nativePlay().then(resolve).catch(reject);
          }, scenario.hangingPlayMs);
        });
      };

      document.querySelector('[data-a-target="player-overlay-play-button"]').addEventListener("click", () => {
        void video.play();
      });

      const toggleButton = document.querySelector('[data-a-target="player-play-pause-button"]');

      function syncToggleLabel() {
        toggleButton.setAttribute(
          "aria-label",
          video.paused ? "Play (space/k)" : "Pause (space/k)"
        );
      }

      toggleButton.addEventListener("click", () => {
        if (video.paused) {
          void video.play();
          syncToggleLabel();
          return;
        }

        video.pause();
        syncToggleLabel();
      });

      document.querySelector('[data-a-target="player-fullscreen-button"]').addEventListener("click", async () => {
        if (!scenario.fullscreenWorks) {
          return;
        }

        await player.requestFullscreen();
      });

      document.getElementById("consent-accept").addEventListener("click", () => {
        document.getElementById("consent-banner").hidden = true;
      });

      document
        .querySelector('[data-a-target="content-classification-gate-overlay-start-watching-button"]')
        .addEventListener("click", () => {
          document.getElementById("gate-overlay").hidden = true;
        });

      document.addEventListener("keydown", (event) => {
        if (event.key === " ") {
          if (video.paused) {
            void video.play();
            syncToggleLabel();
            return;
          }

          video.pause();
          syncToggleLabel();
          return;
        }

        if (event.key.toLowerCase() === "f" && scenario.fullscreenHotkeyWorks) {
          void player.requestFullscreen();
        }
      });

      function clearAd() {
        adBanner.hidden = true;
      }

      function startAd() {
        adBanner.hidden = false;
        if (scenario.ad.type === "finite") {
          window.setTimeout(clearAd, scenario.ad.durationMs);
        }
      }

      if (scenario.ad.type === "finite" || scenario.ad.type === "persistent") {
        startAd();
      }

      if (scenario.unsupportedMessage) {
        const message = document.createElement("div");
        message.textContent = scenario.unsupportedMessage;
        document.body.appendChild(message);
      }

      if (!scenario.startsPaused) {
        void video.play();
      } else if (scenario.autoplayStartMs !== null) {
        window.setTimeout(() => {
          void video.play();
          syncToggleLabel();
        }, scenario.autoplayStartMs);
      }

      syncToggleLabel();
    </script>
  </body>
</html>`;
}
