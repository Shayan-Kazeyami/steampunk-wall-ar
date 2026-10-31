// Build the independent Driveway and Garage sources in order: the first output
// clean must finish before the nested route is emitted. Never write to docs.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const cli=require.resolve('webpack-cli/bin/cli.js');
for(const [cwd,output] of [[root,path.join(root,'dist')],[path.join(root,'experiences/garage'),path.join(root,'dist/garage')]]){
 const result=spawnSync(process.execPath,[cli,'--config','config/webpack.config.js','--output-path',output],{cwd,stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
