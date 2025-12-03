import Joi from "joi";

export const registerSchema = Joi.object({
  full_name: Joi.string().min(3).max(100).required(),
  birth_date: Joi.date().iso().required(),
  address: Joi.string().min(5).required(),
  nik: Joi.string().length(16).pattern(/^\d+$/).required(),
  phone_number: Joi.string().min(8).required(),
  email: Joi.string().email().required(),
  username: Joi.string().alphanum().min(5).max(20).required(),
  password: Joi.string().min(8).required(),
  PIN: Joi.string()
    .length(6)
    .pattern(/^\d{6}$/)
    .required(),
});

export const loginSchema = Joi.object({
  username: Joi.string().alphanum().min(3).max(50).required(),
  password: Joi.string().min(1).required(),
});
