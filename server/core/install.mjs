// 发布安装器共用入口。只装代码与服务端配置，不读用户内容或钥匙。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {INSTALL_PORT} from './local.mjs';
export const RELEASE_REPOSITORY = 'https://github.com/lmy-1219/st-rp-backstage.git';
export function isReleaseOrigin(value) {
    const canonical = url => String(url ?? '').trim().replace(/^git@github\.com:/i, 'https://github.com/').replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/').replace(/\.git\/?$/i, '').replace(/\/$/, '').toLowerCase();
    return canonical(value) === canonical(RELEASE_REPOSITORY);
}
export function assertReleaseTree(tree) {
    if (tree.split('\0').filter(Boolean).some(row => {
        const [meta, name] = row.split('\t');
        return !name || /^120000 |^160000 /.test(meta) || name.split('/').some(p => p === '..' || p.toLowerCase() === 'secrets.json');
    })) throw Error('新版含链接、子模块或密钥文件，未更新。');
}
export function releaseCloneProblem({origin, dirty, branch, ahead = 0}, acceptsOrigin = isReleaseOrigin) {
    if (!acceptsOrigin(origin)) return '已有安装目录不是本发布仓，未覆盖。';
    if (dirty || branch !== 'main') return '已有代码有改动或不在main，请先自行保存和核对。';
    if (ahead) return '这份代码里有正本里没有的提交，没更新';
    return null;
}

const NAME='st-rp-backstage';
const upgrade='需要 Node.js 22.13 或以上及 Git。请从 nodejs.org 和 git-scm.com 升级后重试；本次没有修改文件。';
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const gitRun=(args,cwd)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:16*1024*1024}).trim();

export function checkInstallerPrerequisites({nodeVersion=process.versions.node,git=gitRun}={}) {
    const [major,minor]=String(nodeVersion).split('.').map(Number);
    if(!Number.isInteger(major)||major<22||major===22&&!(minor>=13))throw Error(upgrade);
    try{git(['--version']);}catch{throw Error(upgrade);}
}
export function findSt(start,io=fs) {
    let dir=path.resolve(start);
    for(;;){if(stConfig(dir,io)&&io.existsSync(path.join(dir,'server.js')))return dir;const parent=path.dirname(dir);if(parent===dir)return null;dir=parent;}
}
const stConfig=(dir,io)=>[path.join(dir,'config.yaml'),path.join(dir,'config','config.yaml')].find(file=>io.existsSync(file));
// 只有酒馆根目录下的 data 这一层可以是指向文件夹的链接（手机上常把数据放到共享存储）；它往下、以及插件和配置，仍不许有链接。
export function noLinks(root,file,io = fs,{dataMayLink=false}={}) {
    if(io.lstatSync(root).isSymbolicLink())throw Error('安装目录有链接，请先核对实际路径。');
    let at=root;
    for(const part of path.relative(root,file).split(path.sep).filter(Boolean)){
        if(part==='..'||part.toLowerCase()==='secrets.json')throw Error('安装路径不安全。');
        const parent=at;at=path.join(at,part);
        if(!io.existsSync(at)||!io.lstatSync(at).isSymbolicLink())continue;
        if(dataMayLink&&parent===root&&part==='data'&&io.statSync(at).isDirectory())continue;
        throw Error(`安装路径有链接，未修改：${at}`);
    }
}
async function available(port) {
    const check=host=>new Promise(resolve=>{const server=net.createServer();server.once('error',error=>resolve(host==='::1'&&['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code)));server.listen({port,host,exclusive:true},()=>server.close(()=>resolve(true)));});
    return await check('127.0.0.1')&&await check('::1');
}
export async function firstFreePort({start=INSTALL_PORT,isFree=available}={}) {
    for(let port=start;port<=65535;port++)if(await isFree(port))return port;
    throw Error('找不到空闲后台端口。');
}
function configOf(file,io){if(!io.existsSync(file))return{};const value=JSON.parse(io.readFileSync(file,'utf8'));if(!object(value))throw Error('插件 config.json 不是对象，原文件未覆盖。');return value;}
function assertCloneTree(dir,git) {
    assertReleaseTree(git(['ls-tree','-rz','HEAD'],dir));
}
function ensureClone(dir,{io,git}) {
    if(!io.existsSync(dir)){
        io.mkdirSync(path.dirname(dir),{recursive:true});
        git(['clone','--no-checkout',RELEASE_REPOSITORY,dir]);
        assertCloneTree(dir,git);git(['checkout','main'],dir);
    }else{
        if(!io.existsSync(path.join(dir,'.git')))throw Error('已有安装目录不是本发布仓，未覆盖。');
        const problem=releaseCloneProblem({origin:git(['remote','get-url','origin'],dir),dirty:git(['status','--porcelain','--untracked-files=all'],dir),branch:git(['branch','--show-current'],dir)});
        if(problem)throw Error(problem);
        git(['fetch','origin'],dir);
        assertReleaseTree(git(['ls-tree','-rz','origin/main'],dir));
        git(['merge','--ff-only','origin/main'],dir);
    }
    const release=JSON.parse(io.readFileSync(path.join(dir,'release.json'),'utf8'));
    if(release.layout!==2||!Number.isSafeInteger(release.version)||release.version<1)throw Error('发布仓还不是新安装布局，未改服务端配置。');
    return release;
}

export async function installLayout2({stRoot,dry=false,nodeVersion=process.versions.node,git=gitRun,io=fs,isFree=available}={}) {
    // 所有版本/工具检查必须在任何 mkdir、clone、备份之前。
    checkInstallerPrerequisites({nodeVersion,git});
    if(!stRoot||!findSt(stRoot,io)||path.resolve(findSt(stRoot,io))!==path.resolve(stRoot))throw Error('找不到酒馆的 config.yaml（根目录或 config/ 里），先启动一次酒馆再装。');
    const st=path.resolve(stRoot),plugin=path.join(st,'plugins',NAME),thirdParty=path.join(st,'public','scripts','extensions','third-party',NAME),extension=io.existsSync(thirdParty)?thirdParty:path.join(st,'data','default-user','extensions',NAME),yamlFile=stConfig(st,io),configFile=path.join(plugin,'config.json'),backup=yamlFile+'.rp-emergence.bak';
    // 用酒馆“安装扩展”装给所有用户的，扩展在 third-party 下：就地更新那一份，不再给 default-user 另装一份（否则会出两个面板）。
    if(io.existsSync(path.join(st,'plugins','rp-emergence'))||io.existsSync(path.join(st,'data','default-user','extensions','rp-emergence')))throw Error('发现旧版rp-emergence目录。请先备份并移出旧扩展和插件，避免重复加载；安装器不会替你移动。');
    for(const file of [plugin,extension,yamlFile,configFile,backup,path.join(st,'data','rp-emergence')])noLinks(st,file,io,{dataMayLink:true});
    const yaml=io.readFileSync(yamlFile,'utf8'),lines=[...yaml.matchAll(/^enableServerPlugins:[^\r\n]*$/gm)];
    if(lines.length!==1)throw Error('config.yaml的enableServerPlugins行缺失或重复，未修改。');
    const nextYaml=yaml.replace(/^enableServerPlugins:[^\r\n]*$/m,'enableServerPlugins: true');
    const stPort=Number(/^port:\s*(\d+)\s*(?:#.*)?$/m.exec(yaml)?.[1]);
    const old=configOf(configFile,io);
    if(own(old,'autoStart')&&!object(old.autoStart)||own(old,'update')&&!object(old.update))throw Error('插件配置项格式不对，原文件未覆盖。');
    const config={...old,autoStart:{...old.autoStart},update:{...old.update}};
    if(!own(config,'port'))config.port=await firstFreePort({isFree:port=>port===stPort?false:isFree(port)});
    if(!Number.isInteger(config.port)||config.port<1||config.port>65535)throw Error('插件端口格式不对，未覆盖用户设置。');
    if(config.port===stPort)throw Error('后台端口与酒馆配置的端口相同，请先调整插件配置。');
    if(!own(config.autoStart,'entry'))config.autoStart.entry=path.join(plugin,'server','core','main.mjs');
    if(!own(config.autoStart,'home'))config.autoStart.home=path.join(st,'data','rp-emergence');
    if(!own(config.update,'follow'))config.update.follow='origin/main';
    const actions={plugin,extension,configFile,port:config.port,home:config.autoStart.home,yamlChanged:nextYaml!==yaml,backup,clones:2};
    if(dry)return{dry:true,...actions};
    const pluginRelease=ensureClone(plugin,{io,git}),extensionRelease=ensureClone(extension,{io,git});
    if(pluginRelease.version!==extensionRelease.version)throw Error('两份代码版本不同，请稍后重跑；服务端配置尚未修改。');
    if(nextYaml!==yaml){if(!io.existsSync(backup))io.writeFileSync(backup,yaml,{flag:'wx'});io.writeFileSync(yamlFile,nextYaml);}
    const configText=JSON.stringify(config,null,2)+'\n';
    if(!io.existsSync(configFile)||io.readFileSync(configFile,'utf8')!==configText)io.writeFileSync(configFile,configText);
    io.mkdirSync(path.join(st,'data','rp-emergence'),{recursive:true});
    return{installed:true,...actions,version:pluginRelease.version};
}

export async function runInstaller(args=process.argv.slice(2)) {
    checkInstallerPrerequisites();
    const i=args.indexOf('--st'),given=i>=0?args[i+1]:args.find(x=>!x.startsWith('--'));
    let st=given?path.resolve(given):findSt(process.cwd());
    if(!st){const rl=createInterface({input:process.stdin,output:process.stdout});try{st=(await rl.question('SillyTavern目录在哪里？')).trim().replace(/^"|"$/g,'');}finally{rl.close();}}
    const result=await installLayout2({stRoot:st,dry:args.includes('--dry')});
    console.log(result.dry?'预演完成，没有修改文件。':"装好了，重启酒馆，在扩展面板里找‘RP：幕后’，去‘设置 → 钥匙和模型’填钥匙。");
    console.log(JSON.stringify(result,null,2));return result;
}
