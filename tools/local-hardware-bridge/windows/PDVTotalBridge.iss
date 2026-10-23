#define AppName "PDV Total - Conector Local"
#define AppVersion "1.0.0"
[Setup]
AppId={{88B168C4-9313-4988-966D-8D1C0B34EB59}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={localappdata}\ArtiSys\PDVTotalBridge
DefaultGroupName=PDV Total
OutputDir=..\..\..\dist\bridge-windows
OutputBaseFilename=PDVTotalBridgeSetup
PrivilegesRequired=lowest
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
DisableProgramGroupPage=yes
[Files]
Source: "node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\main.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bridge.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\remote-relay.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\stty-args.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\print.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\drawer.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "configure.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "start-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion
[Tasks]
Name: "autostart"; Description: "Iniciar conector ao entrar no Windows (recomendado)"; Flags: checkedonce
[Icons]
Name: "{userstartup}\PDV Total Conector"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-hidden.vbs"""; WorkingDir: "{app}"; Tasks: autostart
Name: "{group}\PDV Total - Iniciar conector"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-hidden.vbs"""; WorkingDir: "{app}"
[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\configure.ps1"" -Origin ""{code:GetOrigin}"""; Flags: runhidden waituntilterminated
Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-hidden.vbs"""; Description: "Iniciar conector agora"; Flags: postinstall nowait skipifsilent
[Code]
var OriginPage: TInputQueryWizardPage;
procedure InitializeWizard;
begin
  OriginPage := CreateInputQueryPage(wpSelectDir,
    'Conectar ao PDV Total', 'Informe o endereço seguro do seu PDV',
    'Use o domínio HTTPS exato onde o PDV Total é acessado no navegador.');
  OriginPage.Add('Endereço do PDV (ex.: https://pdv.artisys.dev):', False);
  OriginPage.Values[0] := '';
end;
function NextButtonClick(CurPageID: Integer): Boolean;
var S: String;
begin
  Result := True;
  if CurPageID = OriginPage.ID then
  begin
    S := Trim(OriginPage.Values[0]);
    if (Pos('https://', Lowercase(S)) <> 1) or
       (Pos(' ', S) > 0) or (Pos('"', S) > 0) or
       (Pos('?', S) > 0) or (Pos('#', S) > 0) then
    begin
      MsgBox('Informe a origem HTTPS exata, sem caminho, espaços ou parâmetros.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;
function GetOrigin(Param: String): String;
begin
  Result := Trim(OriginPage.Values[0]);
end;
