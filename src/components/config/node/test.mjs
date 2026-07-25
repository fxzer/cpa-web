import 'dotenv/config'
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const {
  S3_ENDPOINT,
  S3_REGION,
  S3_ACCESS_KEY,
  S3_SECRET_KEY,
  S3_BUCKET,
  S3_FORCE_PATH_STYLE,
} = process.env

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  forcePathStyle: S3_FORCE_PATH_STYLE === 'true',
})

const key = `hello-${Date.now()}.txt`
const body = `你好 fxzer, 这是来自本地 MinIO 的测试. ${new Date().toISOString()}`

console.log('▶ 上传对象:', key)
await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: 'text/plain' }))
console.log('✅ 上传成功')

console.log('\n▶ 列出 bucket 中的对象 (最多 5 个):')
const list = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, MaxKeys: 5 }))
for (const obj of list.Contents ?? []) {
  console.log(`  - ${obj.Key}  (${obj.Size} bytes)`)
}

console.log('\n▶ 生成 5 分钟有效的预签名下载 URL:')
const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn: 300 })
console.log(url)
console.log('\n💡 复制上面的 URL 到浏览器或 curl 测试下载')
