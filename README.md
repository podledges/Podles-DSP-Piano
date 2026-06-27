# PPAP (Podles Piano AParatus)

> Has not been done before. Marketable name and Product in stores,
> advertisable on tiktok, reddit. 
> PPAP? pen pineapple apple pen? oh wait no its podle's apparataus! 

## Introduction 

### The issue

The *most notable* issue that has bugged piano players alike - HAving to turb the page midinputs. 

Its such a simple problem, yet everlooming. Especially since we value freedom when 'playing around' on the piano, this issue seems to occur randomly, we are not neccessarily willing to be 'locked in' sightreading random sheets online. More like mindlessly practicing, inbetween tasks, where navigating through a mobile app with a cluttered ui - is too inconvenient (given the mindlessness). **With our specific trained algorithim,** decting the seequence of notes leading up to a page turn, where the algorithim, seamlessly rolls over to the next page (*with a near zero misturn rate.*)

> PROBLEM:  PIANO PLAYING PIECE, with sheet on IPAD (common today), i reach the end of my bar and page, have to swipe up on ipad --> swiping up breaks the whole tempo and movment -
> 	> THIS ISSUE IS WHY PROS ARE STILL RELYING ON PHYSICAL SHEET MUSIC

### Current Soluttions

My initial reaction to this issue: *how has there not been an app made for this?* 

Well there has, one in Apr 2026 (long after I asked that question) (500 downloads (pretty decent in 2 months)). Approaching the problem again, it seems like the main issue establishing a popular enough app, established within the community. But then it dawned on me that the solution, **cant just be an app**.

- No one is scrolling the app store, in their free time.
- Advertising people to download an app, has been associated as annoying or 'spam' in our brains
- The engineering for accuracy and usability, requires a lot more precision, especially when considering how dirt particles block our phone microphones to a varying degree, and how much that can vary -- the position of our phone on the piano and much more. 

This does not mean that there is no solution out there, typically it is an issue that we have learned to accept and try to minimize - Apps that require only a tap to view the next page, using a blinded folder which allows aggressive manual turning of page, or printing the pages out, and utilizing as much area as possible. 

> It is a workaroundable issue, and not a specific enough issue for people to go out searching and purchasing solution. It would struggle to acquire many user downloads and it would not have reliability and accuracy issues. 
>
> POSSIBLE SOLUTION: all lacked in some way or form, in the past -- chips could not do that many things, for the same price --> and ML has evolved to the point of plug and play really

> 2026 April EasternEuropean developer made an app for this, using iPhone or tablet midi input or microphone. 500 downloads (pretty decent in 2 months)

## My Perspective

Do we really just learn how to work around this issue and accept it? Well no we should not, eventually we will come up with a digital solution to this. Some of the physical workarounds, require effort, set-up and purchases, coupled with other issues. *Tapping a screen* still requires added additional movement, and can be annoying.  **I believe** that an affordable *relatively cheap* product can act as a one-time purchase and set-up solution for all of a pianist needs. I do hope for piano to grow bigger and i do see the community expanding, as it serves as one of those rare moments we do not have to stare at a screen. 

However, if we were to make a product that is purchasable to a user, we would have to be solving a bunch of other issues, while achieving many other functionalities, in order to actually compete with other apps one might use. There will also have to be some areas of design, that has to engineered perfectly in order to not make the product serve as an annoyance to the user. 


## Solution 
## 🚀 Quickstart Guide

### 1. Launch the Laptop Server
```bash
# Navigate to the server folder
cd server

# Install dependencies (Express, CORS, WS, Multer)
npm install

# Run the server
npm start
```
*The server will run on `http://localhost:8080` / `ws://localhost:8080`.*

### 2. Launch the Mobile Client
```bash
# Navigate to the mobile folder
cd mobile

# Start the Expo Go development server
npx expo start
```
- Open Expo Go on your mobile device and scan the QR code to load the app.
- Toggle **LAPTOP SERVER LINK** mode in the app.
- Change the **Laptop Server Address** to your laptop's local IP and port (e.g., `192.168.1.100:8080`). You can find your laptop's IP by running `ipconfig` (Windows) or `ifconfig` (macOS/Linux).
- Press **Connect**.

---

## ⚡ How to Demo

1. **Load/Upload Sheet Music:** Load a sheet music PDF named `ode_to_joy_sheet_music.pdf` (either via **Upload PDF** or **Load Mock**).
2. **Initialize Tracker:** Click **Transcribe Page** to request the page notes structure. This compiles the page notes and registers them with the Server Progress Tracker.
3. **Simulate Playback:**
   - Tap notes on the virtual piano in the mobile app, OR
   - Send simulated note triggers to the server using `curl` or Postman:
     ```bash
     curl -X POST http://localhost:8080/sim-note -H "Content-Type: application/json" -d "{\"note\":\"E4\"}"
     ```
   - Watch the logs in the telemetry console. When you play the final notes of the page, the server will broadcast the `PAGE_TURN` event, and the mobile app's viewer will instantly flip to Page 2!
