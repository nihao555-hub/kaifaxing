/**
 * 付费源能做到的，不是绕过登录墙，而是下面四种生意。
 * 我们能对齐的是 1/2/4；3 是私人通讯录生意，不做。
 */

export const PAID_SOURCE_MODELS = [
  {
    key: 'platform',
    title: '向平台买解锁',
    examples: '阿里国际站金牌 + 报价权益、中国制造网会员、IndiaMART 付费卖家',
    how: '买家公司名和联系方式本来就在平台库里。你付钱、报价或开通会员后，平台在卖家后台/官方 API 里打开字段。公开列表故意不给，用来逼你付费。',
    weCan: '同一条路。配阿里官方 Key，或把后台导出的 buyer_company_name 灌进来，再走现有背调。填 Key 不会让公开昵称卡突然长出邮箱。',
    weWont: '不登录爬 Buyer profile，不绕 Cloudflare。',
  },
  {
    key: 'license',
    title: '买授权数据源',
    examples: 'OpenCorporates、Companies House 完整 API、USASpending（已免费）、海关提单 ImportGenius/Panjiva、D&B / 中国信保',
    how: '工商和制裁的上游是各国登记处；付费聚合器只是一个 Key 查很多国家。海关/信用是另一份要单独买的授权，公开网上没有公司级提单和拖账分。',
    weCan: '工商：已经在打各国免费登记口（GLEIF/Sirene/Brreg 等）。英国 Companies House 官方 API 有免费 Key，配上就按名称查，和 OpenCorporates 查英国是同一上游。海关/信保：用他们的导出 JSON 导入，不爬付费站。',
    weWont: '不爬 ImportYeti / Panjiva 登录页冒充官方库。',
  },
  {
    key: 'crm',
    title: '通讯录众包',
    examples: 'Apollo、ZoomInfo、Lusha、RocketReach',
    how: '用户把 CRM 通讯录授权给他们，再卖「这个人的邮箱和直拨」。准确率参差，欧盟/英国对个邮更严。这和「询盘方是哪家公司」不是同一份数据。',
    weCan: '你自己在那些工具里导出后，只要带公司名 + 公司域角色邮箱，可以按商业导入灌进来。',
    weWont: '不接 Hunter/Apollo 去扒私人 Gmail，不按人名拼 firstname.lastname@。',
  },
  {
    key: 'guess',
    title: '邮箱猜测',
    examples: 'Hunter 模式、Findymail、部分「外贸获客」插件',
    how: '知道域名后穷举 first.last@、sales@。命中率靠撞，容易进垃圾箱，也不是背调。',
    weCan: '只收官网/Impressum 上明文写的 info@ / procurement@。',
    weWont: '不猜测私人邮箱。',
  },
];

export function paidSourceStatus({
  alibabaReady = false,
  companiesHouseReady = false,
  openCorporatesReady = false,
} = {}) {
  return {
    models: PAID_SOURCE_MODELS,
    connectors: [
      {
        key: 'alibaba',
        name: '阿里国际站官方 API',
        model: 'platform',
        ready: alibabaReady,
        need: 'ALIBABA_APP_KEY / SECRET / SESSION（卖家授权）',
        gets: '你有权看的 RFQ 列表；公司名/邮箱通常要报价后才有',
      },
      {
        key: 'companies_house',
        name: '英国 Companies House',
        model: 'license',
        ready: companiesHouseReady,
        need: 'COMPANIES_HOUSE_API_KEY（官网免费申请）',
        gets: '英国公司法定名、登记号、状态。OpenCorporates 查英国用的就是这份。',
      },
      {
        key: 'opencorporates',
        name: 'OpenCorporates',
        model: 'license',
        ready: openCorporatesReady,
        need: 'OPENCORPORATES_API_KEY',
        gets: '多国工商聚合。没 Key 时我们继续打各国免费登记口。',
      },
      {
        key: 'export',
        name: '付费库 / 卖家后台导出',
        model: 'license',
        ready: true,
        need: 'JSON：source + items',
        gets: '阿里后台、Apollo 导出、海关 CSV 转 JSON 后的公司名和角色邮箱',
      },
    ],
  };
}

export function normalizePaidExportRow(row = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
    }
    return '';
  };
  return {
    company: pick(
      'buyer_company_name', 'organization_name', 'organisation_name', 'consignee_name',
      'company_name', 'companyName', 'company', '买家公司', '公司名称',
    ),
    name: pick('buyer_name', 'contact_name', 'name', '买家', '联系人'),
    email: pick('buyer_email', 'work_email', 'email', 'contactEmail', '邮箱'),
    country: pick('country', 'buyer_country', '国家', 'Country'),
    title: pick('subject', 'title', 'product', '询盘标题'),
    painPoints: pick('description', 'requirement', 'painPoints', '需求'),
    awardId: pick('rfq_id', 'rfqId', 'company_number', 'id'),
    url: pick('url', 'link', 'sourceUrl', 'profile_url'),
    website: pick('website', 'domain', 'homepage'),
    regNo: pick('company_number', 'regNo', 'registration_number', 'lei', '登记号'),
  };
}
