export function containedPictureRect(rect:DOMRect,videoWidth:number,videoHeight:number):DOMRect {
 if(!videoWidth||!videoHeight||!rect.width||!rect.height)return rect;
 const scale=Math.min(rect.width/videoWidth,rect.height/videoHeight),width=videoWidth*scale,height=videoHeight*scale;
 return new DOMRect(rect.left+(rect.width-width)/2,rect.top+(rect.height-height)/2,width,height);
}
