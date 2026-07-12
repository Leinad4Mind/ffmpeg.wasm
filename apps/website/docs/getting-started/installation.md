import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Installation

:::note
ffmpeg.wasm only supports running in browser, see [FAQ](/docs/faq) for more
details
:::

## Package Managers

Install ffmpeg.wasm using package managers like npm and yarn:

<Tabs>
<TabItem value="npm" label="npm" default>

```bash
npm install @ffmpeg-wasm-browser/ffmpeg @ffmpeg/util
```

</TabItem>
<TabItem value="yarn" label="yarn">

```bash
yarn add @ffmpeg-wasm-browser/ffmpeg @ffmpeg/util
```

</TabItem>
</Tabs>

:::info
As `@ffmpeg-wasm-browser/ffmpeg` spawns a web worker, you cannot import `@ffmpeg-wasm-browser/ffmpeg` from CDN like
jsdelivr. It is recommended to download it and host it on your server most of the time.
:::
