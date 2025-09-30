# It's MyTabs

Open source, web based, self hostable guitar/bass tab viewer and player, similar to Songsterr.

## Demo

https://its-mytabs.kuma.pet/tab/1?audio=youtube-VuKSlOT__9s&track=2

## Features

- Free and open source (MIT License)
- Supports guitar tabs and bass tabs
- Sync your tabs with audio files (.mp3, .ogg) or Youtube videos
- MIDI Synth - able to mute tracks and solo tracks
- Supports .gp, .gpx, .gp3, .gp4, .gp5, .musicxml, .capx formats
- Simple UI/UX
- Offer different cursor modes:
  - No cursor (just auto scroll the tab) - You can use it to learn to coop with drums, not just following the cursor
  - Highlight the current bar
  - Follow cursor
- Notes coloring
- Dark/Light tab colors
- Able to show the score view instead of tab view
- Able to share tabs with others with a link

## Installation

Support: x64, ARM64

Tip: Youtube videos may not work on a private ip address (e.g. 192.168.x.x), use `localhost` or a public ip/domain instead.

### Docker Compose

Download the [compose.yaml]() file and put it in an empty folder.

```yaml
services:
    app:
        image: louislam/its-mytabs:1
        ports:
            # Host Port:Container Port
            - "47777:47777"
        volumes:
            # Host Path:Container Path
            - ./data:/app/data
        restart: unless-stopped
````

```bash
docker compose up  # Run in foreground
# or
docker compose up -d  # Run in background
```

Go to `http://localhost:47777` to access the web UI.

### Docker

```bash
docker run -d --name its-mytabs -p 47777:47777 -v its-mytabs:/app/data --restart unless-stopped louislam/its-mytabs:1
```

Go to `http://localhost:47777` to access the web UI.

### Deno (Non Docker) (Linux/Windows/MacOS)

Requirements:

- [Deno](https://deno.land/) 2.4.4 or above
- Git

```bash
git clone https://github.com/louislam/its-mytabs.git
cd its-mytabs
git checkout 1.0.0 --force
deno task setup
deno task start
```

Go to `http://localhost:47777` to access the web UI.

### Windows (exe)

Download the latest release from [Releases]() page, unzip it, and run `its-mytabs.exe`.

## Screenshots

## Environment Variables

You can create `.env` file to use.

```ini

# (string) Server Host (Default: not set, bind to all interfaces)
MYTABS_HOST=

# (string) Server Port (Default: 47777)
MYTABS_PORT=47777

# (boolean) Whether to launch the browser when starting the app (Desktop only) (Default: true)
MYTABS_LAUNCH_BROWSER=true
```

## Motivation

A few months ago, I saw a music game called Rocksmith 2014 Remastered on sale on Steam. I bought it, grabbed my brother's abandoned bass, and started playing.

I had 100+ hours in the game, and I loved it. However, I started to realize that I was just following the screen and hitting notes, I cannot actually do anything outside the game. So I decided to
actually learn to play bass, learn how to read the tab.

So I found many tools online such as `MuseScore`, `Soundslice`. Eventually, I subscribed to `Songsterr`, I absolutely love it, especial for its UI/UX. However, it is not perfect, many songs don't sync
with youtube/audio source correctly, the cursor is confusing due to out-fo-sync issues. There is no manual sync feature. I have also looked into other tools like Soundslice, Guitar Pro 8, which offer
sync tools, but they are hard to use. Since most of my favourite songs follow the bpm perfectly, I just want something that able to sync the first bar, and good to go.

Plus, I am not a fan of subscription models.

After searching, I could not find any open source projects that is similar to `Songsterr`, so I decided to make one for myself to learn bass.

Don't forget to ⭐ this repo if you like it!

## Side Notes

The demo tab Hare no Hi ni (ハレの日に) by Reira Ushio (汐れいら), which is the ending song from the anime "The Fragrant Flower Blooms with Dignity" (薫る花は凛と咲く).

Beautiful song, and I love the bass line.

It was AI generated on Songsterr, and the bass tab was inaccurate, so I fixed it by my ear.

Since I am a beginner, I re-arranged some parts (fewer slide) to make it easier to play. Hope you enjoy it too.

## Free Resources

- [Ultimate Guitar](https://www.ultimate-guitar.com/) - Some free tabs in *.gp format

- [911Tabs](https://www.911tabs.com/) - Search engine for tabs
- [MuseScore (Free Download filtered)](https://musescore.com/sheetmusic?instrument=72%2C73&recording_type=free-download) - Some free tabs in MusicXML format
- [GProTab](https://gprotab.net/) - Free Guitar Pro tabs in *.gp format

## Special Thanks

- [AlphaTab](https://github.com/CoderLine/alphaTab) by [Daniel Kuschny](https://github.com/Danielku15) - The tab rendering engine
