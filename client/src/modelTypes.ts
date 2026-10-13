export type ModelFeatureInput = {
  Household_Size: number;
  Number_of_Appliances: number;
  Fan_Usage_Hours: number;
  Fridge_Usage_Hours: number;
  AC_Usage_Hours: number;
  TV_Usage_Hours: number;
  Monitor_Usage_Hours: number;
  MotorPump_Usage_Hours: number;
  Appliance_Usage_Hours: number;
  Working_Hours: number;
  Temperature: number;
  Humidity: number;
  Month: number;
  Previous_Month_Units: number;
  Current_Month_Units: number;
  Peak_Usage: number;
  Off_Peak_Usage: number;
  Cost_Per_Unit: number;
  Monthly_Bill: number;
  Year: number;
  Carbon_Footprint: number;
  Usage_Efficiency: number;
  Previous_Month_Bill: number;
  Bill_Change: number;
  Peak_Usage_Percent: number;
  Yearly_Consumption_Estimate: number;
  Savings_Potential_Score: number;
  Consumer_Type: string;
  Consumer_Category: string;
  Region: string;
  City: string;
  Building_Type: string;
  Business_Type: string;
  Weather: string;
  Season: string;
  Tariff_Category: string;
  Billing_Cycle: string;
  Payment_Status: string;
};

export type ModelPredictionResponse = {
  expires_on: string;
  models: {
    units?: { predicted_kwh: number };
    bill?: { predicted_amount: number };
  };
  subsidy: {
    eligible: boolean;
    billing_cycle: string;
    gross_units: number;
    free_units: number;
    payable_units: number;
    rule: string;
  };
  error?: string;
};
