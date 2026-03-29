# Enhanced Memory Optimization (EMO)

Enhanced Memory Optimization (EMO) is based on the spaced repetition principle, aiming to improve long-term retention by adaptively scheduling reviews according to memory strength.

![Teaser](figures/main.png "Teaser")

## Functions
- [X] Practice mode
    - [X] Flash card
    - [X] Word
    - [X] Meaning (* Better with GPU)
- [X] Study mode (Leitner System)
    - [X] Customize reviewing days
- [X] Export/Import words

## Install Issues:

### Issue 1: 
“LitAtlas.app” is damaged and can’t be opened. You should eject the disk image.

#### Reason: 
The downloaded unauthorized application will be quarantined by default.
#### Solution:  
```bash
# replace /Applications/YourAppName.app with actual APP path 
# (default will be /Applications/EMO Flashcards.app)
xattr -cr /Applications/YourAppName.app
```