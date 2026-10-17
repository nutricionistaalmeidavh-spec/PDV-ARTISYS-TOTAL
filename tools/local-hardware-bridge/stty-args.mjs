// macOS/BSD stty selects the device with -f; GNU/Linux stty uses -F.
// Keep platform branching unit-testable on Linux CI before shipping to macOS.
export function sttyArgs(device,platform=process.platform){
  if(platform!=='darwin'&&platform!=='linux')throw new Error('Sistema operacional não suportado para gaveta serial stty.');
  if(typeof device!=='string'||!device.startsWith('/dev/'))throw new Error('Dispositivo serial local inválido.');
  return [platform==='darwin'?'-f':'-F',device,'9600','cs8','-cstopb','-parenb','raw','-echo'];
}
