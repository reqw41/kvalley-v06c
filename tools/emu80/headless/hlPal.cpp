// Headless PAL implementation (без SDL, без GUI, без звука).
#include <iostream>
#include <fstream>
#include <sstream>
#include <chrono>
#include <thread>
#include <cstring>
#include <dirent.h>
#include <sys/stat.h>

#include "hlPal.h"
#include "hlPalWindow.h"

using namespace std;

HlFrame g_hlFrame;

static string basePath = "./";
static int g_sampleRate = 48000;

// palInit/palQuit/palIdle даёт общий src/Pal.cpp

const string& palGetBasePath() {return basePath;}
void palSetBasePath(const string& path) {basePath = path; if (!basePath.empty() && basePath.back() != '/') basePath += '/';}

void palStart() {}
void palPause() {}
void palResume() {}
void palExecute() {} // главный цикл ведёт hlMain

uint64_t palGetCounter() {
    return chrono::duration_cast<chrono::microseconds>(chrono::steady_clock::now().time_since_epoch()).count();
}
uint64_t palGetCounterFreq() {return 1000000;}
void palDelay(uint64_t) {}

bool palSetSampleRate(int sampleRate) {g_sampleRate = sampleRate; return true;}
int palGetSampleRate() {return g_sampleRate;}
bool palSetFrameRate(int) {return true;}
bool palSetVsync(bool) {return true;}

string palMakeFullFileName(const string& fileName)
{
    if (fileName.empty() || fileName[0] == '/' || fileName[0] == '.')
        return fileName;
    return basePath + fileName;
}

int palReadFromFile(const string& fileName, int offset, int sizeToRead, uint8_t* buffer, bool useBasePath)
{
    string fullName = useBasePath ? palMakeFullFileName(fileName) : fileName;
    ifstream f(fullName, ios::binary);
    if (!f) return 0;
    f.seekg(offset);
    f.read(reinterpret_cast<char*>(buffer), sizeToRead);
    return int(f.gcount());
}

uint8_t* palReadFile(const string& fileName, int& fileSize, bool useBasePath)
{
    string fullName = useBasePath ? palMakeFullFileName(fileName) : fileName;
    ifstream f(fullName, ios::binary | ios::ate);
    if (!f) return nullptr;
    fileSize = int(f.tellg());
    f.seekg(0);
    uint8_t* buf = new uint8_t[fileSize];
    f.read(reinterpret_cast<char*>(buf), fileSize);
    return buf;
}

string palMakeCaseInsensitivePath(string basePath, const string& caseInsensitivePath)
{
    return basePath + caseInsensitivePath;
}

void palRequestForQuit() {}
void palDebugRequest() {}

void palPlaySample(int16_t) {}
void palPlaySample(int16_t, int16_t) {}

string palGetDefaultPlatform() {return "";}

void palCopyTextToClipboard(const char*) {}
string palGetTextFromClipboard() {return "";}

string palOpenFileDialog(const string&, const string&, bool, PalWindow*) {return "";}
void palUpdateConfig() {}

bool palChoosePlatform(vector<PlatformInfo>&, int&, bool&, bool, PalWindow*) {return false;}
bool palChooseConfiguration(const string&, PalWindow*) {return false;}
void palSetRunFileName(const string&) {}
void palShowConfigWindow(int) {}

void palGetPalDefines(list<string>& defineList) {defineList.push_back("SDL");}
void palGetPlatformDefines(const string&, map<string, string>&) {}

void palAddTabToConfigWindow(int, const string&) {}
void palRemoveTabFromConfigWindow(int) {}
void palAddRadioSelectorToTab(int, int, const string&, const string&, const string&, SelectItem*, int) {}
void palSetTabOptFileName(int, string) {}

void palWxProcessMessages() {}

void palLog(const string& s) {cerr << s << endl;}

EmuLog& EmuLog::operator<<(const string& s) {palLog(s); return *this;}
EmuLog& EmuLog::operator<<(int n) {ostringstream oss; oss << n; palLog(oss.str()); return *this;}

void palMsgBox(const string& msg, bool) {cerr << msg << endl;}

EmuLog emuLog;

void palGetDirContent(const string& dir, list<PalFileInfo*>& fileList)
{
    DIR* pDir;
    dirent* dp;
    string utf8Dir = dir;
    if (!utf8Dir.empty() && utf8Dir.back() != '/')
        utf8Dir += "/";
    if ((pDir = opendir(utf8Dir.c_str()))) {
        while ((dp = readdir(pDir))) {
            PalFileInfo* newFile = new PalFileInfo;
            newFile->fileName = dp->d_name;
            if (newFile->fileName == "." || newFile->fileName == "..") {delete newFile; continue;}
            string fullPath = utf8Dir + newFile->fileName;
            struct stat entryInfo;
            if (stat(fullPath.c_str(), &entryInfo) != 0) {delete newFile; continue;}
            newFile->isDir = S_ISDIR(entryInfo.st_mode);
            newFile->size = uint32_t(entryInfo.st_size);
            newFile->year = 2000; newFile->month = 1; newFile->day = 1;
            newFile->hour = 0; newFile->minute = 0; newFile->second = 0;
            fileList.push_back(newFile);
        }
        closedir(pDir);
    }
}
