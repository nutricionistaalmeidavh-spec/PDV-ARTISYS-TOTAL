export const COMMON_FIXTURE_PACKS = [
  {
    id: 'common/base',
    revision: 1,
    data: {
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      demo: true,
    },
  },
  {
    id: 'common/customer',
    revision: 1,
    data: {
      customers: [
        {
          externalKey: 'demo-customer-1',
          name: 'Cliente Demonstração',
          email: 'cliente.demo@example.invalid',
          phone: '16999990000',
        },
      ],
    },
  },
  {
    id: 'common/employee',
    revision: 1,
    data: {
      employees: [
        {
          externalKey: 'demo-employee-1',
          name: 'Colaborador Demonstração',
          role: 'demo',
        },
      ],
    },
  },
];
