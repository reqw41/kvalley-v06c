// Headless PalWindow: захватывает кадр в память вместо отрисовки.
#ifndef HLPALWINDOW_H
#define HLPALWINDOW_H

#include <string>
#include <vector>
#include <cstdint>
#include <cstring>

#include "../EmuTypes.h"
#include "../PalKeys.h"

// Последний нарисованный кадр (глобально, окно одно)
struct HlFrame {
    std::vector<uint32_t> pixels;
    int width = 0, height = 0;
    uint64_t drawCount = 0;
};
extern HlFrame g_hlFrame;

class PalWindow
{
    public:
        enum PalWindowStyle { PWS_FIXED, PWS_RESIZABLE, PWS_FULLSCREEN };

        struct PalWindowParams {
            PalWindowStyle style;
            SmoothingType smoothing;
            bool vsync;
            bool visible;
            int width;
            int height;
            std::string title;
            std::string shader;
            bool grayBackground;
            bool desaturate;
            bool autoResize;
        };

        PalWindow() {
            m_params.style = PWS_FIXED;
            m_params.smoothing = ST_NEAREST;
            m_params.vsync = false;
            m_params.visible = false;
            m_params.width = 800;
            m_params.height = 600;
            m_params.grayBackground = false;
            m_params.desaturate = false;
            m_params.autoResize = false;
        }
        virtual ~PalWindow() {}
        void initPalWindow() {}

        static PalWindow* windowById(uint32_t) {return nullptr;}
        void bringToFront() {}
        void maximize() {}
        void focusChanged(bool) {}

        virtual void mouseClick(int, int, PalMouseKey) {}
        virtual void mouseDrag(bool, int, int) = 0;

        virtual std::string getPlatformObjectName() = 0;
        EmuWindowType getWindowType() {return m_windowType;}
        virtual void calcDstRect(int, int, double, int, int, int& dstWidth, int& dstHeight, int& dstX, int& dstY) = 0;

    protected:
        PalWindowParams m_params;

        void setTitle(const std::string& title) {m_params.title = title;}
        void getSize(int& width, int& height) {width = m_params.width; height = m_params.height;}
        void applyParams() {}

        void drawFill(uint32_t) {}
        void drawImage(uint32_t* pixels, int imageWidth, int imageHeight, double,
                       bool blend = false, bool useAlpha = false) {
            (void)blend; (void)useAlpha;
            g_hlFrame.width = imageWidth;
            g_hlFrame.height = imageHeight;
            g_hlFrame.pixels.assign(pixels, pixels + imageWidth * imageHeight);
            g_hlFrame.drawCount++;
        }
        void drawEnd() {}
        void screenshotRequest(const std::string&) {}

        EmuWindowType m_windowType = EWT_UNDEFINED;
};

#endif // HLPALWINDOW_H
