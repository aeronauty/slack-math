#ifndef UNICODE
#define UNICODE
#endif
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commdlg.h>
#include <wchar.h>
#include <stdlib.h>
#include <string.h>

#define START 100
#define STOP 101
#define CHOOSE 102
#define STATUS_UPDATE (WM_APP + 1)
#define WORKER_EXIT (WM_APP + 2)
static HWND window, heading, detail, startButton, stopButton, chooseButton;
static HANDLE worker, workerInput;
static HFONT font, titleFont, boldFont, codeFont;
static wchar_t folder[32768], chosenSlack[32768];
static int dpi = 96;
static BOOL disabled = FALSE, closing = FALSE, errorShown = FALSE;
typedef struct { char state[32]; wchar_t detail[2048]; } Update;
typedef struct { HANDLE output, process; } Reader;
static int scale(int x) { return MulDiv(x, dpi, 96); }
static void message(const wchar_t *text) { SetWindowTextW(heading, L"Could not enable math"); SetWindowTextW(detail, text); }
static HWND control(const wchar_t *kind, const wchar_t *text, DWORD style, int x, int y, int width, int height, int id, HFONT face) {
    HWND result = CreateWindowExW(0, kind, text, WS_CHILD | WS_VISIBLE | style, scale(x), scale(y), scale(width), scale(height), window, (HMENU)(INT_PTR)id, GetModuleHandleW(NULL), NULL);
    SendMessageW(result, WM_SETFONT, (WPARAM)face, TRUE);
    return result;
}
// Read the two string fields emitted by our worker, without interpreting them as commands.
static void stringField(const char *line, const char *key, char *out, size_t capacity) {
    char pattern[64]; size_t used = 0;
    out[0] = 0;
    if (strlen(key) > 40) return;
    strcpy(pattern, "\""); strcat(pattern, key); strcat(pattern, "\":\"");
    const char *cursor = strstr(line, pattern);
    if (!cursor) return;
    cursor += strlen(pattern);
    while (*cursor && *cursor != '"' && used + 1 < capacity) {
        char ch = *cursor++;
        if (ch == '\\' && *cursor) {
            ch = *cursor++;
            if (ch == 'n') ch = '\n';
            else if (ch == 'r') ch = '\r';
            else if (ch == 't') ch = '\t';
        }
        out[used++] = ch;
    }
    out[used] = 0;
}
static DWORD WINAPI readWorker(LPVOID argument) {
    Reader *reader = argument;
    char chunk[1024], line[16384]; size_t used = 0; DWORD count;
    while (ReadFile(reader->output, chunk, sizeof(chunk), &count, NULL) && count) {
        for (DWORD i = 0; i < count; i++) {
            if (chunk[i] == '\n') {
                line[used] = 0;
                Update *update = calloc(1, sizeof(Update));
                if (update) {
                    char text[8192];
                    stringField(line, "state", update->state, sizeof(update->state));
                    stringField(line, "detail", text, sizeof(text));
                    MultiByteToWideChar(CP_UTF8, 0, text, -1, update->detail, 2048);
                    if (!PostMessageW(window, STATUS_UPDATE, 0, (LPARAM)update)) free(update);
                }
                used = 0;
            } else if (used + 1 < sizeof(line)) line[used++] = chunk[i];
        }
    }
    CloseHandle(reader->output);
    WaitForSingleObject(reader->process, INFINITE);
    DWORD code = 1; GetExitCodeProcess(reader->process, &code);
    PostMessageW(window, WORKER_EXIT, code, 0);
    free(reader);
    return 0;
}
static void command(const char *text) {
    DWORD written;
    if (workerInput && !WriteFile(workerInput, text, (DWORD)strlen(text), &written, NULL)) message(L"The helper is not responding. Quit Slack normally, then relaunch Slack Math.");
}
static void launchWorker(void) {
    if (worker) {
        if (disabled) { disabled = FALSE; EnableWindow(startButton, FALSE); EnableWindow(stopButton, TRUE); command("enable\n"); }
        return;
    }
    wchar_t runtime[32768], script[32768], arguments[65536];
    swprintf(runtime, 32768, L"%ls\\Resources\\node.exe", folder);
    swprintf(script, 32768, L"%ls\\Resources\\companion.cjs", folder);
    if (GetFileAttributesW(runtime) == INVALID_FILE_ATTRIBUTES || GetFileAttributesW(script) == INVALID_FILE_ATTRIBUTES) { message(L"Extract the entire ZIP before opening Slack Math.exe. Keep the Resources folder beside it."); return; }
    swprintf(arguments, 65536, L"\"%ls\" \"%ls\"%ls%ls%ls", runtime, script, chosenSlack[0] ? L" \"" : L"", chosenSlack, chosenSlack[0] ? L"\"" : L"");
    SECURITY_ATTRIBUTES security = { sizeof(security), NULL, TRUE };
    HANDLE outputRead = NULL, outputWrite = NULL, inputRead = NULL, inputWrite = NULL;
    HANDLE nullFile = INVALID_HANDLE_VALUE;
    STARTUPINFOEXW startup; ZeroMemory(&startup, sizeof(startup));
    PROCESS_INFORMATION process; ZeroMemory(&process, sizeof(process));
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
    BOOL attributesReady = FALSE;
    if (!CreatePipe(&outputRead, &outputWrite, &security, 0) || !CreatePipe(&inputRead, &inputWrite, &security, 0)) goto failure;
    SetHandleInformation(outputRead, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(inputWrite, HANDLE_FLAG_INHERIT, 0);
    nullFile = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (nullFile == INVALID_HANDLE_VALUE) goto failure;
    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(NULL, 1, 0, &bytes);
    attributes = HeapAlloc(GetProcessHeap(), 0, bytes);
    if (!attributes || !InitializeProcThreadAttributeList(attributes, 1, 0, &bytes)) goto failure;
    attributesReady = TRUE;
    HANDLE inherited[] = { inputRead, outputWrite, nullFile };
    if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), NULL, NULL)) goto failure;
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = inputRead;
    startup.StartupInfo.hStdOutput = outputWrite;
    startup.StartupInfo.hStdError = nullFile;
    startup.lpAttributeList = attributes;
    // Do not let a caller's Node startup hooks run inside the bundled helper.
    SetEnvironmentVariableW(L"NODE_OPTIONS", NULL);
    SetEnvironmentVariableW(L"NODE_PATH", NULL);
    SetEnvironmentVariableW(L"NODE_EXTRA_CA_CERTS", NULL);
    if (!CreateProcessW(runtime, arguments, NULL, NULL, TRUE, CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, NULL, folder, &startup.StartupInfo, &process)) goto failure;
    DeleteProcThreadAttributeList(attributes); HeapFree(GetProcessHeap(), 0, attributes); attributes = NULL;
    CloseHandle(inputRead); CloseHandle(outputWrite); CloseHandle(nullFile); CloseHandle(process.hThread);
    worker = process.hProcess; workerInput = inputWrite;
    Reader *reader = malloc(sizeof(Reader));
    if (!reader) { CloseHandle(outputRead); CloseHandle(workerInput); workerInput = NULL; message(L"Not enough memory to read helper status. Quit Slack normally and reopen Slack Math."); return; }
    reader->output = outputRead; reader->process = worker;
    HANDLE thread = CreateThread(NULL, 0, readWorker, reader, 0, NULL);
    if (!thread) { free(reader); CloseHandle(outputRead); CloseHandle(workerInput); workerInput = NULL; message(L"Could not read helper status. Quit Slack normally and reopen Slack Math."); return; }
    CloseHandle(thread);
    errorShown = FALSE; disabled = FALSE;
    EnableWindow(startButton, FALSE); EnableWindow(chooseButton, FALSE); EnableWindow(stopButton, TRUE);
    SetWindowTextW(heading, L"Connecting to Slack..."); SetWindowTextW(detail, L"Checking compatibility and waiting for a workspace to load.");
    return;
failure:
    if (attributes) { if (attributesReady) DeleteProcThreadAttributeList(attributes); HeapFree(GetProcessHeap(), 0, attributes); }
    if (outputRead) CloseHandle(outputRead); if (outputWrite) CloseHandle(outputWrite);
    if (inputRead) CloseHandle(inputRead); if (inputWrite) CloseHandle(inputWrite);
    if (nullFile != INVALID_HANDLE_VALUE) CloseHandle(nullFile);
    message(L"The bundled helper could not start. Extract the full ZIP to a writable folder and try again.");
}
static LRESULT CALLBACK windowProc(HWND hwnd, UINT event, WPARAM w, LPARAM l) {
    switch (event) {
    case WM_COMMAND:
        if (LOWORD(w) == START) launchWorker();
        if (LOWORD(w) == STOP) { EnableWindow(stopButton, FALSE); command("disable\n"); }
        if (LOWORD(w) == CHOOSE) {
            wchar_t selected[32768] = L"";
            OPENFILENAMEW dialog; ZeroMemory(&dialog, sizeof(dialog));
            dialog.lStructSize = sizeof(dialog); dialog.hwndOwner = hwnd;
            dialog.lpstrFilter = L"Slack (slack.exe)\0slack.exe\0\0";
            dialog.lpstrFile = selected; dialog.nMaxFile = 32768;
            dialog.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
            if (GetOpenFileNameW(&dialog)) {
                const wchar_t *name = wcsrchr(selected, L'\\'); name = name ? name + 1 : selected;
                if (_wcsicmp(name, L"slack.exe") != 0) message(L"Choose the Slack application named Slack.exe.");
                else { wcscpy(chosenSlack, selected); SetWindowTextW(detail, L"Slack selected. Quit Slack completely, then click Launch Slack with Math."); }
            }
        }
        return 0;
    case STATUS_UPDATE: {
        Update *update = (Update *)l;
        if (!strcmp(update->state, "error")) { errorShown = TRUE; message(update->detail); }
        else if (!errorShown) {
            if (!strcmp(update->state, "enabled")) { SetWindowTextW(heading, L"Math is enabled"); EnableWindow(stopButton, TRUE); }
            else if (!strcmp(update->state, "disabled")) {
                disabled = TRUE; SetWindowTextW(heading, L"Math is off");
                SetWindowTextW(startButton, L"Turn Math On"); EnableWindow(startButton, TRUE); EnableWindow(stopButton, FALSE);
            } else SetWindowTextW(heading, L"Connecting to Slack...");
            SetWindowTextW(detail, update->detail);
        }
        free(update); return 0;
    }
    case WORKER_EXIT:
        if (worker) { CloseHandle(worker); worker = NULL; }
        if (workerInput) { CloseHandle(workerInput); workerInput = NULL; }
        EnableWindow(startButton, TRUE); EnableWindow(chooseButton, TRUE); EnableWindow(stopButton, FALSE);
        SetWindowTextW(startButton, L"Launch Slack with Math");
        if (!errorShown) { SetWindowTextW(heading, L"Math is off"); SetWindowTextW(detail, L"Slack is closed. Launch it here to enable math again."); }
        KillTimer(hwnd, 1);
        if (closing) DestroyWindow(hwnd);
        return 0;
    case WM_CLOSE: {
        if (!worker) { DestroyWindow(hwnd); return 0; }
        int answer = MessageBoxW(hwnd, L"Quitting this companion also closes its Slack connection. Quit both apps? This will end active Slack calls.\n\nChoose No to keep the companion running minimized. To keep Slack open without math, use Turn Math Off.", L"Quit Slack Math and Slack?", MB_YESNOCANCEL | MB_ICONQUESTION | MB_DEFBUTTON2);
        if (answer == IDYES) {
            closing = TRUE; command("quit\n"); SetTimer(hwnd, 1, 15000, NULL);
        } else if (answer == IDNO) ShowWindow(hwnd, SW_MINIMIZE);
        return 0;
    }
    case WM_TIMER:
        if (w == 1) { KillTimer(hwnd, 1); closing = FALSE; SetWindowTextW(detail, L"Slack has not quit. Quit it normally from its system tray icon, then close Slack Math."); }
        return 0;
    case WM_CTLCOLORSTATIC: {
        HDC dc = (HDC)w; SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, (HWND)l == heading ? RGB(65, 60, 175) : RGB(45, 45, 50));
        return (LRESULT)GetSysColorBrush(COLOR_WINDOW);
    }
    case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(hwnd, event, w, l);
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR arguments, int show) {
    (void)previous;
    SetProcessDPIAware(); HDC dc = GetDC(NULL); dpi = GetDeviceCaps(dc, LOGPIXELSX); ReleaseDC(NULL, dc);
    GetModuleFileNameW(NULL, folder, 32768); wchar_t *slash = wcsrchr(folder, L'\\'); if (!slash) return 1; *slash = 0;
    font = CreateFontW(-scale(14),0,0,0,FW_NORMAL,0,0,0,DEFAULT_CHARSET,0,0,CLEARTYPE_QUALITY,0,L"Segoe UI");
    titleFont = CreateFontW(-scale(28),0,0,0,FW_BOLD,0,0,0,DEFAULT_CHARSET,0,0,CLEARTYPE_QUALITY,0,L"Segoe UI");
    boldFont = CreateFontW(-scale(17),0,0,0,FW_SEMIBOLD,0,0,0,DEFAULT_CHARSET,0,0,CLEARTYPE_QUALITY,0,L"Segoe UI");
    codeFont = CreateFontW(-scale(15),0,0,0,FW_NORMAL,0,0,0,DEFAULT_CHARSET,0,0,CLEARTYPE_QUALITY,0,L"Consolas");
    wchar_t iconPath[32768]; swprintf(iconPath,32768,L"%ls\\Resources\\SlackMath.ico",folder);
    WNDCLASSW type; ZeroMemory(&type,sizeof(type)); type.lpfnWndProc = windowProc; type.hInstance = instance;
    type.lpszClassName = L"SlackMathCompanion"; type.hCursor = LoadCursor(NULL, IDC_ARROW); type.hbrBackground = GetSysColorBrush(COLOR_WINDOW);
    type.hIcon = LoadImageW(NULL,iconPath,IMAGE_ICON,0,0,LR_LOADFROMFILE | LR_DEFAULTSIZE);
    RegisterClassW(&type);
    DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    RECT bounds = {0,0,scale(600),scale(490)}; AdjustWindowRect(&bounds,style,FALSE);
    window = CreateWindowW(type.lpszClassName,L"Slack Math",style,CW_USEDEFAULT,CW_USEDEFAULT,bounds.right-bounds.left,bounds.bottom-bounds.top,NULL,NULL,instance,NULL);
    if (!window) return 1;
    control(L"STATIC",L"Slack Math",0,32,28,530,24,0,boldFont);
    control(L"STATIC",L"Math, right inside Slack.",0,32,65,540,42,0,titleFont);
    control(L"STATIC",L"Typeset equations in your conversations. Everything renders locally.",0,32,114,530,38,0,font);
    heading = control(L"STATIC",L"Ready to launch",0,32,165,530,25,0,boldFont);
    detail = control(L"STATIC",L"Quit Slack completely first, including its system tray icon. Then launch it here.",0,32,200,530,45,0,font);
    startButton = control(L"BUTTON",L"Launch Slack with Math",WS_TABSTOP | BS_DEFPUSHBUTTON,32,258,220,36,START,font);
    stopButton = control(L"BUTTON",L"Turn Math Off",WS_TABSTOP,264,258,125,36,STOP,font); EnableWindow(stopButton,FALSE);
    chooseButton = control(L"BUTTON",L"Choose Slack...",WS_TABSTOP,401,258,150,36,CHOOSE,font);
    control(L"STATIC",L"Try it in a message",0,32,324,530,24,0,boldFont);
    control(L"STATIC",L"The energy is \\(E=mc^2\\).",0,32,359,530,26,0,codeFont);
    control(L"STATIC",L"For complex formulas, format the entire \\(…\\) as inline code.\nOther readers need Slack Math too.",0,32,398,530,42,0,font);
    control(L"STATIC",L"Private connection, no listening port. Unofficial Windows preview.",0,32,456,530,24,0,font);
    if (wcsstr(arguments,L"--self-test")) {
        wchar_t nodePath[32768]; swprintf(nodePath,32768,L"%ls\\Resources\\node.exe",folder);
        int code = heading && detail && startButton && stopButton && chooseButton && GetFileAttributesW(nodePath) != INVALID_FILE_ATTRIBUTES ? 0 : 1;
        DestroyWindow(window); return code;
    }
    ShowWindow(window,show); UpdateWindow(window);
    MSG event; while (GetMessageW(&event,NULL,0,0) > 0) { if (!IsDialogMessageW(window,&event)) { TranslateMessage(&event); DispatchMessageW(&event); } }
    DeleteObject(font); DeleteObject(titleFont); DeleteObject(boldFont); DeleteObject(codeFont);
    return 0;
}
