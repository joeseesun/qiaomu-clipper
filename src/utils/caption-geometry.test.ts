import {expect,it,vi} from 'vitest';
import {containedPictureRect} from './caption-geometry';
it('centres a contained landscape or portrait picture without stretching it',()=>{vi.stubGlobal('DOMRect',class {constructor(public x:number,public y:number,public width:number,public height:number){} get left(){return this.x;}get top(){return this.y;}});const rect=new DOMRect(10,20,1920,1080);expect(containedPictureRect(rect,1080,1920)).toMatchObject({x:666.25,y:20,width:607.5,height:1080});expect(containedPictureRect(rect,0,0)).toBe(rect);vi.unstubAllGlobals();});
