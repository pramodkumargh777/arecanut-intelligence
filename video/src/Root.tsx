import { Composition } from "remotion";
import "./brand";
import { BrandIntro, BRAND_INTRO_FRAMES } from "./BrandIntro";
import { Carousel, CAROUSEL_H, CAROUSEL_W } from "./Carousel";
import { NEW_GARDEN } from "./data/carousels/newGarden";
import { Encourage, ENCOURAGE_FRAMES } from "./Encourage";
import { PromoReel, PROMO_REEL_FRAMES, promoFrames, type PromoReelProps } from "./PromoReel";
import { DailyStory, type DailyStoryProps } from "./DailyStory";
import { DAILY_FRAMES, DailyRates, totalFrames, type DailyRatesProps } from "./DailyRates";
import type { RatesData } from "./data/rates";
import snapshot from "./data/snapshot.json";

/**
 * Vertical 9:16 at 30 fps: the size YouTube Shorts, Instagram Reels and WhatsApp Status all take.
 *
 * DailyRates gets its rates as input props. `npm run render` first runs scripts/fetch-rates.mjs, which fetches today's
 * verified rates in Node (the API's CORS rules block the render browser) and stops if the API can't be reached, so
 * old rates are never posted by accident. Without props (Studio, render:snapshot) it uses the bundled snapshot.
 */
export const RemotionRoot = () => (
  <>
    <Composition
      id="DailyRates"
      component={DailyRates}
      durationInFrames={DAILY_FRAMES}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ data: snapshot as RatesData, source: "snapshot" } as DailyRatesProps}
      calculateMetadata={({ props }) => ({ durationInFrames: totalFrames(props) })}
    />
    <Composition
      id="DailyRatesEN"
      component={DailyRates}
      durationInFrames={DAILY_FRAMES}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ data: snapshot as RatesData, source: "snapshot", lang: "en" } as DailyRatesProps}
      calculateMetadata={({ props }) => ({ durationInFrames: totalFrames(props) })}
    />
    {/* The daily rates Story (Instagram Stories, WhatsApp Status): a single still, rendered with `remotion still`. */}
    <Composition id="DailyStory" component={DailyStory} durationInFrames={1} fps={30} width={1080} height={1920}
      defaultProps={{ data: snapshot as RatesData, lang: "kn" } as DailyStoryProps} />
    {/* Premium promo with original music and voice, Kannada and English; its length follows the voice-over. */}
    <Composition id="PromoReel" component={PromoReel} durationInFrames={PROMO_REEL_FRAMES} fps={30} width={1080} height={1920}
      defaultProps={{ data: snapshot as RatesData, lang: "kn" } as PromoReelProps}
      calculateMetadata={({ props }) => ({ durationInFrames: promoFrames(props) })} />
    <Composition id="PromoReelEN" component={PromoReel} durationInFrames={PROMO_REEL_FRAMES} fps={30} width={1080} height={1920}
      defaultProps={{ data: snapshot as RatesData, lang: "en" } as PromoReelProps}
      calculateMetadata={({ props }) => ({ durationInFrames: promoFrames(props) })} />
    <Composition id="Encourage" component={Encourage} durationInFrames={ENCOURAGE_FRAMES} fps={30} width={1080} height={1920} />
    {/* Instagram carousel: one slide per frame (render with scripts/carousel.sh). */}
    <Composition id="CarouselNewGarden" component={Carousel} durationInFrames={NEW_GARDEN.slides.length} fps={30} width={CAROUSEL_W} height={CAROUSEL_H} />
    <Composition id="BrandIntro" component={BrandIntro} durationInFrames={BRAND_INTRO_FRAMES} fps={30} width={1080} height={1920} />
  </>
);
