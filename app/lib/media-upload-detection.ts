/** Detect supported binary formats from a file signature, not a user-supplied MIME label.
 * This supports browsers that upload valid JPG/PNG/WEBP/MP4 with an empty MIME.
 * Never re-label HEIC/MOV as compatible; they require real conversion.
 */
export async function detectSupportedMediaMime(file:File):Promise<string|null>{
  const bytes=new Uint8Array(await file.slice(0,32).arrayBuffer());
  const starts=(hex:number[])=>hex.every((v,i)=>bytes[i]===v);
  if(starts([0xff,0xd8,0xff]))return 'image/jpeg';
  if(starts([137,80,78,71,13,10,26,10]))return 'image/png';
  const ascii=(begin:number,len:number)=>String.fromCharCode(...bytes.slice(begin,begin+len));
  if(ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP')return 'image/webp';
  if(ascii(4,4)==='ftyp'){
    const brand=ascii(8,4);
    if(brand.startsWith('3g'))return 'video/3gpp';
    if(['isom','iso2','iso5','iso6','mp41','mp42','avc1','M4V ','MSNV'].includes(brand))
      return 'video/mp4';
  }
  return null;
}

export function detectedMimeMatchesName(file:File,mime:string):boolean {
 const name=file.name.toLowerCase();
 const suffixes:Record<string,string[]>={
   'image/jpeg':['.jpg','.jpeg'],
   'image/png':['.png'],
   'image/webp':['.webp'],
   'video/mp4':['.mp4'],
   'video/3gpp':['.3gp','.3gpp'],
 };
 const endings=suffixes[mime]||[];
 return endings.some(ext=>name.endsWith(ext));
}
