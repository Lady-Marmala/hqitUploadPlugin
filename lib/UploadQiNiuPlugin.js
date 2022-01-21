
const path = require("path")
const qiniu = require("qiniu")

module.exports = class UploadQiNiuPlugin {
  constructor(options) {
    const { accessKey = "", secretKey = "" } = options;
    this.bucket = options.bucket;
    this.prefix = options.prefix || null;
    const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
    const putPolicy = new qiniu.rs.PutPolicy({ scope: this.bucket });
    this.delPrefix = options.delPrefix || null;
    this.include = options.include || null;
    this.outputPath = "";
    this.uploadToken = putPolicy.uploadToken(mac);

    const config = new qiniu.conf.Config();
    this.formUploader = new qiniu.form_up.FormUploader(config);
    this.bucketManager = new qiniu.rs.BucketManager(mac, config);
  }
  upload (filename) {
    return new Promise((resolve, reject) => {
      if (this.include && !this.include.some(reg => {
        return reg.test(filename)
      })) {
        return resolve()
      }

      const realPath = path.join(this.outputPath, filename)
      //每次都要生成新的 putExtra 避免文件类型相同
      const putExtra = new qiniu.form_up.PutExtra()

      // 上传文件
      this.formUploader.putFile(
        this.uploadToken,
        this.prefix ? `${this.prefix}/${filename}` : filename,
        realPath,
        putExtra,
        (err, body) => {
          err ? reject(err) : resolve(body)
        }
      )
    })
  }
  deleteSource () {
    if (!this.delPrefix) return;
    const options = {
      prefix: `${this.delPrefix}`,
    };
    let deleteOperations = [];
    let bucketManager = this.bucketManager;
    const bucket = this.bucket
    bucketManager.listPrefix(bucket, options, function (err, respBody, respInfo) {
      if (err) {
        throw err;
      }
      if (respInfo.statusCode == 200) {
        respBody.items.forEach((item) => {
          deleteOperations.push(qiniu.rs.deleteOp(bucket, item.key))
        });
        bucketManager.batch(deleteOperations, function (err) {
          if (err) {
            throw err;
          }
        });
      }
    });
  }
  apply (compiler) {
    compiler.hooks.afterEmit.tapPromise("UploadQiNiuPlugin", (compilation) => {
      this.deleteSource();
      this.outputPath = compiler.outputPath
      const assets = compilation.assets
      let promises = []
      Object.keys(assets).forEach((filename) => {
        promises.push(this.upload(filename))
      })
      return Promise.all(promises)
    })
  }
}
