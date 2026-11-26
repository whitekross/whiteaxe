# Whiteaxe — Ubuntu installation and first physical validation

Status: software release candidate, not hardware-certified. Phase 4 passed 44 automated tests and 19 Chrome checks. Phase 5 adds blocking UI typecheck, malformed SVG handling and calibration fixtures. Do not assume machine accuracy until the operator completes the tests.

## Install locally (Node serial mode)

Use Node.js 24 LTS (minimum 22) and npm, Git and a browser. On Ubuntu:

```sh
node --version
npm --version
git clone https://github.com/whitekross/whiteaxe.git
cd whiteaxe
git switch feature/release-validation
npm ci
npm test
node cli.mjs
```

Use the candidate branch until PR #6 is merged; after approval use main. npm ci runs the upstream prepare/build lifecycle. Open http://localhost:9080. After subsequent updates use git pull, npm ci, and node cli.mjs. Stop with Ctrl+C only after all motion has stopped. No global npm install, Python or deployment. The inherited server listens on network interfaces, not solely loopback: use only a trusted private network, do not expose port 9080 or enable CORS. Close other programs that use the USB port.

### USB permissions
Connect and power on the plotter, but do not click Plot. Check the actual device and your groups:

```sh
ls -l /dev/ttyACM* /dev/ttyUSB* 2>/dev/null
id -nG
```

If the serial device belongs to dialout and your user is not in that group:

```sh
sudo usermod -aG dialout "$USER"
```

Log out completely and log back in (or reboot); check id -nG again. Do not run the server as root or chmod the device world-writable. If autodetection is unsuccessful, use the actual serial path (example only): node cli.mjs --device /dev/ttyACM0. Verify the correct hardware model and connection status. A connected Node server is not itself proof of an attached plotter; the original server can simulate a plot when no device is attached.

## Physical checks (operator only)

Use scrap paper, no valuable artwork. Follow the machine's manual for homing, pen mounting and clearance. Make sure the paper is secured, origin is known, arm starts at its configured home and the measured usable X/Y travel fits the paper and the intended drawing. Default pen home is 0,0; do not change it casually. Never move the carriage while motors are engaged. A pen change can disturb the origin because the upstream driver releases motors after each layer. Verify the exact physical starting origin before every live layer; stop if uncertain. Keep hand clear of moving parts and disconnect power if motion becomes unsafe.

1. Confirm connection and correct hardware. Test pen up/down on scrap paper at suitable heights; no XY motion.
2. Open 01-square-20mm.svg. Choose Manual, 100% scale, rotation 0°, X=20 mm, Y=20 mm **only if** these coordinates and the return home are within the measured safe travel and paper. Enter actual machine travel X/Y, not an assumed model size. Use low speed and safe pen heights. Preview first; optionally remove pen for initial motion check. Plot with a pen and measure horizontal and vertical sides (20 mm), offsets relative to the known paper origin and return home. Record deviations.
3. Open 02-alignment-30mm.svg. In Manual at 100%, choose a safe position (e.g. 20,20 only if verified). Select stroke layers, run Dry run first. For live mode, choose two inks. The black square should measure 30 mm. Red corner segments terminate on black cross endpoints, red X crosses its center. Wait until fully stopped; change pen without shifting paper or carriage, check origin and height. Explicitly confirm and start each ink. Record registration error.
4. Open 03-pause-40mm.svg. Use safe position and low speed, verify pause/resume and cancel on scrap paper. Pause may wait for a pen-up transition. Never assume cancellation completed until motion stops; verify return to origin before any new job. If origin is lost, abort and re-establish it following hardware instructions.
5. Record actual model, OS, Node version, measured travel, dimensions, registration, pause/resume/cancel result, and any abnormal sound or drift. A conservative initial target is within 0.5 mm for this simple test, not a guaranteed hardware specification. Do not proceed to large artwork if any check fails.

All SVGs use physical mm dimensions; set Manual at 100% so Fit does not change scale. Screen rulers and preview width do not guarantee physical ink width. Fit/Original retain legacy behavior; use validated Manual for these tests. No hardware testing has been performed by CI.

## Optional browser mode
The existing npm run start-webserial builds/serves the WebSerial UI, for browsers with WebSerial support; close the Node serial app first. Node mode is the primary Ubuntu test route.

## Result record
- [ ] USB and pen control
- [ ] 20 mm square measured
- [ ] X/Y offsets and return home
- [ ] Two-ink registration
- [ ] Pause/resume/cancel
- [ ] No abnormal motion
- [ ] Operator approval for release
