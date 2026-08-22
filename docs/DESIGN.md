---
name: Playerinyo
description: A monochrome projection room for browsing and listening to an owned local music collection.
colors:
  active-white: "#F5F5F5"
  active-white-hot: "#FFFFFF"
  projection-graphite: "#303030"
  projection-shadow: "#101010"
  carbon-black: "#070707"
  stage-black: "#111111"
  raised-graphite: "#1B1B1B"
  paper-white: "#F5F5F5"
  muted-gray: "#A3A3A3"
  disabled-gray: "#686868"
  stage-rule: "#363636"
  danger: "#E5484D"
  control-ink: "#090909"
typography:
  display:
    fontFamily: "'Projection Display', 'Arial Black', sans-serif"
    fontSize: "clamp(34px, 5vw, 66px)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "'Projection Display', 'Arial Black', sans-serif"
    fontSize: "clamp(26px, 3.2vw, 44px)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.035em"
  title:
    fontFamily: "'Projection UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "'Projection UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "'Projection UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  sleeve: "4px"
  compact: "7px"
  control: "8px"
  field: "10px"
  dialog: "12px"
  shell: "18px"
  circle: "50%"
spacing:
  micro: "4px"
  control: "8px"
  shell-gap: "10px"
  component: "14px"
  content: "26px"
  section: "52px"
components:
  primary-button:
    backgroundColor: "{colors.active-white}"
    textColor: "{colors.control-ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "38px"
  secondary-button:
    backgroundColor: "{colors.raised-graphite}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "38px"
  sleeve:
    backgroundColor: "transparent"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.sleeve}"
  search-field:
    backgroundColor: "{colors.raised-graphite}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.field}"
    height: "42px"
  listening-studio:
    backgroundColor: "{colors.projection-graphite}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.shell}"
---

# Design System: Playerinyo

## Overview

**Creative North Star: "Projection Room"**

Playerinyo stages an owned music library as a room of projected sleeves. Carbon-black structure lowers visual noise, broad graphite light fields establish destinations and listening context, and white marks action and current state. Album art is the only full-spectrum material in the interface; danger and fault states alone may use red.

The system is not a streaming-service sidebar and not a simulated hi-fi console. Navigation is a narrow destination dock, content is a cover-led stage, and playback occupies a permanent studio beside the work on desktop.

**Key Characteristics:**

- Graphite light fields against carbon-black structure.
- Square, nearly unframed album and playlist sleeves.
- Paper-white typography with compact neutral-gray support text.
- White reserved for decisive actions, active destinations, focus, and progress.
- One scrolling content stage beside a persistent listening studio.

## Colors

The palette uses only black, graphite, gray, and white for application chrome. Full-spectrum color belongs to owned cover art. Red is a semantic exception reserved for destructive actions, errors, and fault states.

### Primary

- **Projection Graphite:** Owns large identity surfaces, the Home projection field, album detail stage, and the upper Listening Studio.
- **Active White:** Marks active navigation, Play, primary buttons, progress, selection, and keyboard focus.

### Secondary

- **Carbon Black:** Anchors the shell and separates broad graphite fields without decorative borders.
- **Danger Red:** Identifies destructive actions, errors, and fault states only.

### Neutral

- **Stage Black:** Central reading surface and stable dialog ground.
- **Raised Graphite:** Inputs, secondary buttons, tabs, and quiet utility panels.
- **Paper White:** Primary text and high-contrast icon color.
- **Muted Gray:** Metadata, helper copy, inactive controls, and secondary labels.
- **Stage Rule:** Low-emphasis separators in tables and dense lists.

**The Field, Not Confetti Rule.** Graphite owns complete regions. Do not scatter gray chips across a flat dashboard to simulate hierarchy.

**The White Means State Rule.** White communicates action, focus, progress, or current state. It is not ambient wallpaper.

**The Red Means Trouble Rule.** Red appears only for destructive actions, errors, and fault states.

**The Artwork Owns Variety Rule.** Full-spectrum color comes from the listener's covers; interface color establishes hierarchy around them.

## Typography

**Display Font:** Projection Display, the locally packaged Unbounded variable face.

**Body Font:** Projection UI, the locally packaged Atkinson Hyperlegible Next variable face.

**Character:** Unbounded gives room-scale titles a broad projected silhouette. Atkinson Hyperlegible Next keeps dense track, metadata, queue, lyrics, and Settings content readable at compact sizes.

### Hierarchy

- **Display** (600, `clamp(34px, 5vw, 66px)`, 0.98): Home thesis, playlist workspace, statistics, and album identity.
- **Headline** (600, `clamp(26px, 3.2vw, 44px)`, 1): Library and major view titles.
- **Section** (600, 17-23px): Album shelves and grouped workspace headings.
- **Title** (700, 14px, 1.25): Albums, tracks, playlist names, and primary item identity.
- **Body** (500, 14px, 1.5): Explanatory copy with a preferred measure below 65ch.
- **Label** (700, 10-11px): Compact status, metadata, times, and control names.

**The Display Is a Place Rule.** Projection Display names rooms, records, and sections. It does not replace sustained UI copy or metadata.

## Layout

Desktop uses three permanent regions separated by a 10px shell gap: a 68px collapsed destination dock or 256px expanded destination dock, one flexible central stage, and a `clamp(290px, 26vw, 390px)` Listening Studio. Expanded mode is honored only at a safe desktop width while the preference remains saved. The central stage is the only main content scroller except for the expanded dock's bounded playlist shelf. Playlist management is a central workspace, never a second persistent sidebar.

Home begins with a full-width graphite projection field and then moves through cover-led shelves. The first recent sleeve may span two columns to create one decisive visual anchor. Library density remains user-adjustable. Album detail opens into a graphite cover-and-title stage followed by a ruled track table.

At 1180px the dock and studio narrow, the Home projection field stacks, and statistics compact. At 1050px secondary album columns drop from the track table and playlist controls reflow. At 760px the shell becomes a vertical sequence: horizontal destination dock, central stage, then full-width Listening Studio. No layout may introduce page-level horizontal overflow.

**The One Stage Rule.** Home, Library, playlists, Tag Health, search, statistics, album detail, and playlist detail are mutually exclusive central views.

**The Persistent Studio Rule.** Cover, identity, transport, seek, volume, EQ, compact Up Next, Queue, Lyrics, and Now Playing remain reachable while central views change. Compact Up Next is always visible; full Queue and Lyrics expand only when requested. Relaunch restores the complete playback context and saved position in a paused state.

## Elevation & Depth

Depth is structural and directional. Shell regions use offset black shadows; sleeves use a smaller down-right shadow; dialogs use the deepest offset shadow. Stable surfaces do not combine ornamental borders with glass blur. Black-to-graphite tonal changes carry most hierarchy.

- **Shell:** `8px 12px 36px rgba(0, 0, 0, .28)` separates dock, stage, and studio.
- **Sleeve:** `7px 10px 24px rgba(0, 0, 0, .36)` lifts cover art without framing it as a card.
- **Dialog:** `12px 18px 60px rgba(0, 0, 0, .58)` isolates blocking tasks.
- **Focus:** A 3px translucent accent ring is visible around keyboard focus.

**The Sleeve Before Surface Rule.** Album and playlist containers remain transparent; artwork, type, and one directional shadow provide structure.

## Shapes

Sleeves stay square with a tight 4px corner. Compact controls use 7-10px corners. Dialogs use 12px and the three main shell regions use 18px. Circles are reserved for familiar transport actions, status indicators, and icon-only controls. Large content panels are not pills.

## Components

### Buttons

- **Primary:** White fill, dark control ink, 8px corners, and a small offset shadow.
- **Secondary:** Raised graphite fill without an ornamental outline.
- **Ghost:** Transparent at rest; gains one quiet graphite surface on hover.
- **Focus / Disabled:** All variants retain a visible accent focus ring; disabled controls lose contrast and elevation.

### Sleeve Cards

Album and playlist cards have no container fill or border. Artwork is square, tightly rounded, and shadowed. Hover lifts the complete sleeve by 4px. Play and Open remain separate semantic controls.

### Inputs

Inputs use raised graphite, 8-10px corners, and no resting border. Focus deepens the field and introduces the white focus ring. Placeholder text uses muted gray at readable contrast. Native checkboxes remain square; only explicit Settings controls use switch styling.

### Navigation

The semantic logo button toggles a persisted collapsed or expanded dock. Collapsed mode shows one icon per destination and fills the remaining height with as many complete playlist covers as fit, without partial covers or a scrollbar. Expanded mode shows destination labels and an internally scrolling playlist shelf with exactly four tiles per row, names below each sleeve, pinned playlists first, then remaining playlists by recent playback. Viewed and true playback-source playlists use distinct monochrome states; only an overflowing playing-source name may marquee, with a static reduced-motion marker. On narrow or unsafe-width layouts the dock renders collapsed without discarding the expanded preference, and at the mobile breakpoint it becomes horizontal. Regular dock playlist tiles and the generic Playlists destination accept track drops; Liked Songs does not. The generic destination opens playlist selection, while a regular tile adds directly with recoverable feedback.

### Listening Studio

The studio is a permanent graphite-to-black room. Cover art leads at sleeve scale, track identity sits directly below, and transport remains centered. Volume has a full-width row with a percentage readout and mute control. Compact Up Next is persistent; Queue and Lyrics are mutually exclusive expanded panels below it.

### Dense Lists

Track, queue, lyrics, Tag Health, and statistics lists favor separators and tonal row states over individual rounded cards. Playing, selected, missing, drag, loading, empty, and error states remain explicit.

## Do's and Don'ts

### Do:

- **Do** keep owned album art larger and more varied than application chrome.
- **Do** use broad black-to-graphite fields and reserve white for state and action.
- **Do** keep every playback and library operation reachable from the dock, Home tools, studio, command palette, or context actions.
- **Do** preserve visible keyboard focus, drag targets, disabled states, and recoverable startup errors.
- **Do** let responsive layouts recompose the three regions instead of clipping them.

### Don't:

- **Don't** restore the wide persistent playlist sidebar or bottom player.
- **Don't** reintroduce Signal Bench metal, amber readouts, screws, keycaps, or hardware labels.
- **Don't** wrap album shelves in same-sized dashboard cards.
- **Don't** use glass blur on stable reading surfaces.
- **Don't** introduce interface color beyond full-spectrum cover art and semantic danger red.
- **Don't** hide compact Up Next, Queue, Lyrics, EQ, Now Playing, or volume behind an unrelated navigation view.
