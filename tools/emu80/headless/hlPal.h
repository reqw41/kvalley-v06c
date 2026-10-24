// Headless PAL для Emu80 — эксперимент сверки тайминга King's Valley (Вектор-06Ц).
// Реализует минимум pal*-функций без SDL/GUI/звука.
#ifndef HLPAL_H
#define HLPAL_H

#include <string>
#include <vector>
#include <list>
#include <map>
#include <cstdint>

#include "../EmuTypes.h"

class PalWindow;

bool palInit(int& argc, char** argv);
void palQuit();
void palIdle();

const std::string& palGetBasePath();
void palSetBasePath(const std::string& path); // headless-специфично

void palStart();
void palPause();
void palResume();
void palExecute();

uint64_t palGetCounter();
uint64_t palGetCounterFreq();
void palDelay(uint64_t time);

bool palSetSampleRate(int sampleRate);
int palGetSampleRate();
bool palSetFrameRate(int frameRate);
bool palSetVsync(bool vsync);

std::string palMakeFullFileName(const std::string& fileName);
int palReadFromFile(const std::string& fileName, int first, int size, uint8_t* buffer, bool useBasePath = true);
uint8_t* palReadFile(const std::string& fileName, int& fileSize, bool useBasePath = true);
std::string palMakeCaseInsensitivePath(std::string basePath, const std::string& caseInsensitivePath);

void palRequestForQuit();
void palDebugRequest();

void palPlaySample(int16_t sample);
void palPlaySample(int16_t left, int16_t right);

std::string palGetDefaultPlatform();

void palCopyTextToClipboard(const char* text);
std::string palGetTextFromClipboard();

std::string palOpenFileDialog(const std::string& title, const std::string& filter, bool write, PalWindow* window = nullptr);
void palUpdateConfig();

bool palChoosePlatform(std::vector<PlatformInfo>& pi, int& pos, bool& newWnd, bool setDef = false, PalWindow* wnd = nullptr);
bool palChooseConfiguration(const std::string& platformName, PalWindow* wnd);
void palSetRunFileName(const std::string& runFileName);
void palShowConfigWindow(int curTabId = 0);
void palGetPalDefines(std::list<std::string>& defineList);
void palGetPlatformDefines(const std::string& platformName, std::map<std::string, std::string>& definesMap);

void palAddTabToConfigWindow(int tabId, const std::string& tabName);
void palRemoveTabFromConfigWindow(int tabId);
void palAddRadioSelectorToTab(int tabId, int column, const std::string& caption, const std::string& object, const std::string& property, SelectItem* items, int nItems);
void palSetTabOptFileName(int tabId, std::string optFileName);

void palWxProcessMessages();
void palLog(const std::string& s);
void palMsgBox(const std::string& msg, bool critical = false);

class EmuLog
{
    public:
        EmuLog& operator<<(const std::string& s);
        EmuLog& operator<<(int n);
};

extern EmuLog emuLog;

struct PalFileInfo {
    std::string fileName;
    bool isDir;
    unsigned size;
    int second, minute, hour, day, month, year;
};

void palGetDirContent(const std::string& dir, std::list<PalFileInfo*>& fileList);

#endif // HLPAL_H
