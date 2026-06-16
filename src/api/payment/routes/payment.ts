export default {
  routes: [
    {
      method: 'POST',
      path: '/payments/initialize',
      handler: 'payment.initialize',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/payments/verify/:reference',
      handler: 'payment.verify',
      config: {
        auth: false,
      },
    },
  ],
};
