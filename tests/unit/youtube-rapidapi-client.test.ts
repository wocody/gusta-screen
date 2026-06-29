import { describe, expect, it, vi } from "vitest";

import { Deadline } from "../../src/capture/deadline";
import { AppError } from "../../src/errors";
import { createLogger } from "../../src/logger";
import {
  extractYouTubeVideoId,
  RapidApiYouTubeClient,
  selectBestYouTubeMediaUrl
} from "../../src/youtube/rapidapi-client";
import { createTestConfig } from "../helpers/test-config";

const IMAGE_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9kAAAAASUVORK5CYII=",
  "base64"
);

describe("YouTube RapidAPI client", () => {
  it("extracts the video id from watch and live URLs", () => {
    expect(
      extractYouTubeVideoId(
        new URL("https://www.youtube.com/watch?v=watch-video-id")
      )
    ).toBe("watch-video-id");
    expect(
      extractYouTubeVideoId(new URL("https://www.youtube.com/live/live-video-id"))
    ).toBe("live-video-id");
  });

  it("prefers screenshots and selects the middle image from the best variant", () => {
    const mediaUrl = selectBestYouTubeMediaUrl(
      {
        main_thumbnail: [
          {
            width: 1920,
            height: 1080,
            url: "https://images.example.com/thumbnail.jpg"
          }
        ],
        screenshots: [
          {
            width: 1280,
            height: 720,
            urls: [
              "https://images.example.com/shot-1.jpg",
              "https://images.example.com/shot-2.jpg",
              "https://images.example.com/shot-3.jpg"
            ]
          }
        ]
      },
      1920,
      1080
    );

    expect(mediaUrl).toBe("https://images.example.com/shot-2.jpg");
  });

  it("downloads the selected YouTube image from the configured media API", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            screenshots: [
              {
                width: 1280,
                height: 720,
                urls: ["https://images.example.com/a.jpg", "https://images.example.com/b.jpg"]
              }
            ]
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(IMAGE_FIXTURE, {
          status: 200,
          headers: { "content-type": "image/png" }
        })
      );

    const config = createTestConfig();
    const client = new RapidApiYouTubeClient(config, fetchMock);
    const logger = createLogger(config);
    const image = await client.fetchImage(
      {
        provider: "youtube",
        normalizedUrl: "https://www.youtube.com/watch?v=abc123",
        url: new URL("https://www.youtube.com/watch?v=abc123")
      },
      new Deadline(5_000),
      logger
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain(
      "/medias?video_id=abc123"
    );
    expect(image.sourceUrl).toBe("https://images.example.com/b.jpg");
    expect(image.bytes.equals(IMAGE_FIXTURE)).toBe(true);
  });

  it("maps missing media to unsupported content", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ screenshots: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const config = createTestConfig();
    const client = new RapidApiYouTubeClient(config, fetchMock);
    const logger = createLogger(config);

    await expect(
      client.fetchImage(
        {
          provider: "youtube",
          normalizedUrl: "https://www.youtube.com/watch?v=abc123",
          url: new URL("https://www.youtube.com/watch?v=abc123")
        },
        new Deadline(5_000),
        logger
      )
    ).rejects.toBeInstanceOf(AppError);
  });
});
